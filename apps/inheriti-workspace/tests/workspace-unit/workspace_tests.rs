use super::*;
use std::{cell::RefCell, rc::Rc};

#[derive(Default)]
struct State {
    calls: Vec<&'static str>,
    fail: Option<&'static str>,
    teardown_failures: usize,
}

struct Fake(Rc<RefCell<State>>);

impl GuestRuntime for Fake {
    type Error = &'static str;

    fn start(&mut self) -> Result<(), Self::Error> {
        let mut state = self.0.borrow_mut();
        state.calls.push("start");
        if state.fail == Some("start") {
            Err("start")
        } else {
            Ok(())
        }
    }
    fn ingress(&mut self, _: &str, _: &[u8]) -> Result<(), Self::Error> {
        let mut state = self.0.borrow_mut();
        state.calls.push("ingress");
        if state.fail == Some("ingress") {
            Err("ingress")
        } else {
            Ok(())
        }
    }
    fn launch(&mut self, _: &str) -> Result<(), Self::Error> {
        let mut state = self.0.borrow_mut();
        state.calls.push("launch");
        if state.fail == Some("launch") {
            Err("launch")
        } else {
            Ok(())
        }
    }
    fn teardown(&mut self) -> Result<(), Self::Error> {
        let mut state = self.0.borrow_mut();
        state.calls.push("teardown");
        if state.teardown_failures > 0 {
            state.teardown_failures -= 1;
            Err("teardown")
        } else {
            Ok(())
        }
    }
}

fn fixture() -> (Workspace<Fake>, Rc<RefCell<State>>) {
    let state = Rc::new(RefCell::new(State::default()));
    (Workspace::new(Fake(Rc::clone(&state))), state)
}

#[test]
fn opens_one_file_and_tears_down() {
    let (mut workspace, state) = fixture();
    assert_eq!(workspace.open("report.pdf", b"pdf"), Ok(()));
    assert_eq!(
        workspace.open("again.pdf", b"pdf"),
        Err(WorkspaceError::AlreadyOpen)
    );
    assert_eq!(workspace.close(), Ok(()));
    assert_eq!(
        state.borrow().calls,
        ["start", "ingress", "launch", "teardown"]
    );
}

#[test]
fn invalid_input_never_starts_guest() {
    let (mut workspace, state) = fixture();
    for name in [
        "",
        ".",
        "..",
        "../secret",
        "dir\\file",
        "C:drive",
        "bad\0name",
        "CON.txt",
        "trailing.",
    ] {
        assert_eq!(workspace.open(name, b"x"), Err(WorkspaceError::InvalidFile));
    }
    assert_eq!(
        workspace.open("ok.pdf", b""),
        Err(WorkspaceError::InvalidFile)
    );
    assert_eq!(
        workspace.open("ok.pdf", &vec![0; MAX_FILE_BYTES + 1]),
        Err(WorkspaceError::InvalidFile)
    );
    assert!(state.borrow().calls.is_empty());
}

#[test]
fn failures_clean_up_and_allow_retry() {
    for failure in ["start", "ingress", "launch"] {
        let (mut workspace, state) = fixture();
        state.borrow_mut().fail = Some(failure);
        assert_eq!(
            workspace.open("photo.png", b"x"),
            Err(WorkspaceError::Runtime(failure))
        );
        assert_eq!(state.borrow().calls.last(), Some(&"teardown"));
        state.borrow_mut().fail = None;
        assert_eq!(workspace.open("photo.png", b"x"), Ok(()));
    }
}

#[test]
fn failed_teardown_keeps_session_for_retry() {
    let (mut workspace, state) = fixture();
    state.borrow_mut().fail = Some("launch");
    state.borrow_mut().teardown_failures = 1;
    assert_eq!(
        workspace.open("photo.png", b"x"),
        Err(WorkspaceError::Cleanup {
            operation: "launch",
            cleanup: "teardown"
        })
    );
    assert_eq!(
        workspace.open("again.png", b"x"),
        Err(WorkspaceError::AlreadyOpen)
    );
    assert_eq!(workspace.close(), Ok(()));
    assert_eq!(state.borrow().calls.last(), Some(&"teardown"));
}

#[test]
fn admits_two_files_in_one_guest() {
    let (mut workspace, state) = fixture();
    assert_eq!(
        workspace.admit("first.pdf", b"x"),
        Err(WorkspaceError::NotOpen)
    );
    assert_eq!(workspace.open("first.pdf", b"x"), Ok(()));
    assert_eq!(workspace.admit("second.pdf", b"yz"), Ok(()));
    assert_eq!(workspace.close(), Ok(()));
    assert_eq!(
        state.borrow().calls,
        ["start", "ingress", "launch", "ingress", "launch", "teardown"]
    );
}

#[test]
fn rejects_duplicate_and_limits_before_runtime() {
    let (mut workspace, state) = fixture();
    assert_eq!(workspace.open("One.pdf", b"x"), Ok(()));
    let initial_calls = state.borrow().calls.len();
    assert_eq!(
        workspace.admit("one.PDF", b"x"),
        Err(WorkspaceError::DuplicateFile)
    );
    assert_eq!(
        workspace.admit("../bad", b"x"),
        Err(WorkspaceError::InvalidFile)
    );
    assert_eq!(
        workspace.admit("large.pdf", &vec![0; MAX_TOTAL_BYTES]),
        Err(WorkspaceError::AggregateTooLarge)
    );
    assert_eq!(state.borrow().calls.len(), initial_calls);
    for index in 1..MAX_FILES {
        assert_eq!(workspace.admit(&format!("{index}.pdf"), b"x"), Ok(()));
    }
    let calls_at_limit = state.borrow().calls.len();
    assert_eq!(
        workspace.admit("extra.pdf", b"x"),
        Err(WorkspaceError::FileLimitReached)
    );
    assert_eq!(state.borrow().calls.len(), calls_at_limit);
}

#[test]
fn subsequent_failure_tears_down_and_allows_fresh_session() {
    for failure in ["ingress", "launch"] {
        let (mut workspace, state) = fixture();
        assert_eq!(workspace.open("first.pdf", b"x"), Ok(()));
        state.borrow_mut().fail = Some(failure);
        assert_eq!(
            workspace.admit("second.pdf", b"x"),
            Err(WorkspaceError::Runtime(failure))
        );
        assert_eq!(state.borrow().calls.last(), Some(&"teardown"));
        state.borrow_mut().fail = None;
        assert_eq!(workspace.open("second.pdf", b"x"), Ok(()));
    }
}

#[test]
fn subsequent_cleanup_failure_blocks_admission_until_close_retries() {
    let (mut workspace, state) = fixture();
    assert_eq!(workspace.open("first.pdf", b"x"), Ok(()));
    state.borrow_mut().fail = Some("launch");
    state.borrow_mut().teardown_failures = 1;
    assert_eq!(
        workspace.admit("second.pdf", b"x"),
        Err(WorkspaceError::Cleanup {
            operation: "launch",
            cleanup: "teardown"
        })
    );
    let calls_after_failure = state.borrow().calls.len();
    assert_eq!(
        workspace.admit("third.pdf", b"x"),
        Err(WorkspaceError::CleanupPending)
    );
    assert_eq!(state.borrow().calls.len(), calls_after_failure);
    assert_eq!(workspace.close(), Ok(()));
    state.borrow_mut().fail = None;
    assert_eq!(workspace.open("first.pdf", b"x"), Ok(()));
}

#[test]
fn explicit_close_failure_blocks_admission_until_retry() {
    let (mut workspace, state) = fixture();
    assert_eq!(workspace.open("first.pdf", b"x"), Ok(()));
    state.borrow_mut().teardown_failures = 1;
    assert_eq!(workspace.close(), Err(WorkspaceError::Runtime("teardown")));
    let calls_after_failure = state.borrow().calls.len();
    assert_eq!(
        workspace.admit("second.pdf", b"x"),
        Err(WorkspaceError::CleanupPending)
    );
    assert_eq!(state.borrow().calls.len(), calls_after_failure);
    assert_eq!(workspace.close(), Ok(()));
    assert_eq!(workspace.open("second.pdf", b"x"), Ok(()));
}

#[test]
fn permanent_teardown_failure_blocks_reopen_and_drop_only_retries() {
    let (mut workspace, state) = fixture();
    state.borrow_mut().teardown_failures = usize::MAX;
    assert_eq!(workspace.open("photo.png", b"x"), Ok(()));
    assert_eq!(workspace.close(), Err(WorkspaceError::Runtime("teardown")));
    assert_eq!(
        workspace.open("again.png", b"x"),
        Err(WorkspaceError::AlreadyOpen)
    );
    drop(workspace);
    assert_eq!(
        state.borrow().calls,
        ["start", "ingress", "launch", "teardown", "teardown"]
    );
    assert_eq!(state.borrow().teardown_failures, usize::MAX - 2);
}
