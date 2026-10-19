use super::*;
use crate::session::{MAX_FILES, MAX_TOTAL_BYTES};
use std::{cell::RefCell, rc::Rc};

#[derive(Default)]
struct State {
    calls: Vec<&'static str>,
    fail: Option<&'static str>,
    teardown_failures: usize,
    observed_plaintext: Vec<u8>,
}

struct Fake(Rc<RefCell<State>>);

impl GuestRuntime for Fake {
    type Error = &'static str;

    fn start(&mut self) -> Result<(), Self::Error> {
        let mut s = self.0.borrow_mut();
        s.calls.push("start");
        if s.fail == Some("start") {
            Err("start")
        } else {
            Ok(())
        }
    }
    fn ingress(&mut self, _: &str, bytes: &[u8]) -> Result<(), Self::Error> {
        let mut s = self.0.borrow_mut();
        s.calls.push("ingress");
        s.observed_plaintext = bytes.to_vec();
        if s.fail == Some("ingress") {
            Err("ingress")
        } else {
            Ok(())
        }
    }
    fn launch(&mut self, _: &str) -> Result<(), Self::Error> {
        let mut s = self.0.borrow_mut();
        s.calls.push("launch");
        if s.fail == Some("launch") {
            Err("launch")
        } else {
            Ok(())
        }
    }
    fn teardown(&mut self) -> Result<(), Self::Error> {
        let mut s = self.0.borrow_mut();
        s.calls.push("teardown");
        if s.teardown_failures > 0 {
            s.teardown_failures -= 1;
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
fn starts_before_authorization_and_opens_without_file_type_branch() {
    let (mut workspace, state) = fixture();
    assert_eq!(
        workspace.open_authorized("model.unknown", || {
            state.borrow_mut().calls.push("authorize");
            Ok::<_, &'static str>(b"secret".to_vec())
        }),
        Ok(())
    );
    assert_eq!(
        state.borrow().calls,
        ["start", "authorize", "ingress", "launch"]
    );
    assert_eq!(state.borrow().observed_plaintext, b"secret");
    assert_eq!(workspace.close(), Ok(()));
}

#[test]
fn start_failure_never_calls_authorization() {
    let (mut workspace, state) = fixture();
    state.borrow_mut().fail = Some("start");
    assert_eq!(
        workspace.open_authorized("a.pdf", || -> Result<Vec<u8>, &'static str> {
            panic!("authorization must not run")
        }),
        Err(HandoffError::Failure(HandoffFailure::Runtime("start")))
    );
    assert_eq!(state.borrow().calls, ["start", "teardown"]);
}

#[test]
fn authorization_and_invalid_plaintext_close_guest() {
    let (mut workspace, state) = fixture();
    assert_eq!(
        workspace.open_authorized("a.pdf", || Err::<Vec<u8>, _>("denied")),
        Err(HandoffError::Failure(HandoffFailure::Authorization(
            "denied"
        )))
    );
    assert_eq!(state.borrow().calls, ["start", "teardown"]);
    assert_eq!(
        workspace.open_authorized("a.pdf", || Ok::<_, &'static str>(Vec::new())),
        Err(HandoffError::Failure(HandoffFailure::InvalidFile))
    );
    assert_eq!(
        state.borrow().calls,
        ["start", "teardown", "start", "teardown"]
    );
}

#[test]
fn ingress_failure_wipes_before_teardown_and_preserves_cleanup_pending() {
    let (mut workspace, state) = fixture();
    state.borrow_mut().fail = Some("ingress");
    state.borrow_mut().teardown_failures = 1;
    assert_eq!(
        workspace.open_authorized("a.pdf", || Ok::<_, &'static str>(b"secret".to_vec())),
        Err(HandoffError::Cleanup {
            operation: HandoffFailure::Runtime("ingress"),
            cleanup: "teardown"
        })
    );
    assert_eq!(state.borrow().calls, ["start", "ingress", "teardown"]);
    assert_eq!(
        workspace.admit("next.pdf", b"x"),
        Err(WorkspaceError::CleanupPending)
    );
    assert_eq!(workspace.close(), Ok(()));
}

#[test]
fn authorization_cleanup_failure_blocks_new_open_until_retry() {
    let (mut workspace, state) = fixture();
    state.borrow_mut().teardown_failures = 1;
    assert_eq!(
        workspace.open_authorized("a.pdf", || Err::<Vec<u8>, _>("denied")),
        Err(HandoffError::Cleanup {
            operation: HandoffFailure::Authorization("denied"),
            cleanup: "teardown",
        })
    );
    assert_eq!(
        workspace.open_authorized("b.pdf", || -> Result<Vec<u8>, &'static str> {
            panic!("authorization must not run while cleanup is pending")
        }),
        Err(HandoffError::AlreadyOpen)
    );
    assert_eq!(workspace.close(), Ok(()));
}

#[test]
fn wipes_owned_bytes() {
    let mut bytes = b"secret".to_vec();
    wipe(&mut bytes);
    assert_eq!(bytes, &[0; 6]);
}

#[test]
fn admits_two_more_authorized_files_without_restarting_guest() {
    let (mut workspace, state) = fixture();
    workspace
        .open_authorized("first.pdf", || Ok::<_, &'static str>(b"pdf".to_vec()))
        .unwrap();
    for (name, bytes) in [("photo.png", b"png".as_slice()), ("table.xlsx", b"xlsx")] {
        assert_eq!(
            workspace.admit_authorized(name, || {
                state.borrow_mut().calls.push("authorize");
                Ok::<_, &'static str>(bytes.to_vec())
            }),
            Ok(())
        );
    }
    assert_eq!(
        state.borrow().calls,
        [
            "start",
            "ingress",
            "launch",
            "authorize",
            "ingress",
            "launch",
            "authorize",
            "ingress",
            "launch"
        ]
    );
    assert_eq!(workspace.close(), Ok(()));
}

#[test]
fn admission_preflight_rejects_without_authorizing() {
    let (mut workspace, state) = fixture();
    assert_eq!(
        workspace.admit_authorized("first.pdf", || -> Result<Vec<u8>, &'static str> {
            panic!("no active guest")
        }),
        Err(HandoffError::Admission(WorkspaceError::NotOpen))
    );
    workspace
        .open_authorized("first.pdf", || Ok::<_, &'static str>(b"x".to_vec()))
        .unwrap();
    for (name, expected) in [
        ("FIRST.PDF", WorkspaceError::DuplicateFile),
        ("../bad", WorkspaceError::InvalidFile),
    ] {
        assert_eq!(
            workspace.admit_authorized(name, || -> Result<Vec<u8>, &'static str> {
                panic!("preflight must precede authorization")
            }),
            Err(HandoffError::Admission(expected))
        );
    }
    for index in 1..MAX_FILES {
        workspace
            .admit_authorized(&format!("file{index}"), || {
                Ok::<_, &'static str>(b"x".to_vec())
            })
            .unwrap();
    }
    assert_eq!(
        workspace.admit_authorized("extra", || -> Result<Vec<u8>, &'static str> {
            panic!("file limit must precede authorization")
        }),
        Err(HandoffError::Admission(WorkspaceError::FileLimitReached))
    );
    assert_eq!(
        state
            .borrow()
            .calls
            .iter()
            .filter(|call| **call == "authorize")
            .count(),
        0
    );
}

#[test]
fn post_authorization_failure_closes_entire_session_and_retryable_cleanup() {
    for failure in ["denied", "invalid", "aggregate", "ingress", "launch"] {
        let (mut workspace, state) = fixture();
        workspace
            .open_authorized("first.pdf", || Ok::<_, &'static str>(b"x".to_vec()))
            .unwrap();
        state.borrow_mut().teardown_failures = 1;
        if matches!(failure, "ingress" | "launch") {
            state.borrow_mut().fail = Some(failure);
        }
        let result = workspace.admit_authorized("second.pdf", || match failure {
            "denied" => Err("denied"),
            "invalid" => Ok(Vec::new()),
            "aggregate" => Ok(vec![7; MAX_TOTAL_BYTES]),
            _ => Ok(b"secret".to_vec()),
        });
        let expected = match failure {
            "denied" => HandoffFailure::Authorization("denied"),
            "invalid" => HandoffFailure::InvalidFile,
            "aggregate" => HandoffFailure::AggregateTooLarge,
            _ => HandoffFailure::Runtime(failure),
        };
        assert_eq!(
            result,
            Err(HandoffError::Cleanup {
                operation: expected,
                cleanup: "teardown",
            })
        );
        assert_eq!(
            workspace.admit_authorized("third.pdf", || -> Result<Vec<u8>, &'static str> {
                panic!("cleanup pending must precede authorization")
            }),
            Err(HandoffError::Admission(WorkspaceError::CleanupPending))
        );
        assert_eq!(workspace.close(), Ok(()));
        state.borrow_mut().fail = None;
        assert_eq!(
            workspace.open_authorized("fresh.pdf", || Ok::<_, &'static str>(b"x".to_vec())),
            Ok(())
        );
    }
}
