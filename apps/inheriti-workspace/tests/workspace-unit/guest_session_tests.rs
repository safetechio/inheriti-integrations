use super::*;

struct RetryRuntime {
    teardown_attempts: u8,
}

impl GuestRuntime for RetryRuntime {
    type Error = &'static str;

    fn start(&mut self) -> Result<(), Self::Error> {
        Ok(())
    }

    fn ingress(&mut self, _name: &str, _bytes: &[u8]) -> Result<(), Self::Error> {
        Ok(())
    }

    fn launch(&mut self, _name: &str) -> Result<(), Self::Error> {
        Ok(())
    }

    fn teardown(&mut self) -> Result<(), Self::Error> {
        self.teardown_attempts += 1;
        if self.teardown_attempts == 1 {
            Err("try again")
        } else {
            Ok(())
        }
    }
}

#[test]
fn failed_cleanup_retains_session_until_retry_succeeds() {
    let mut workspace = Workspace::new(RetryRuntime {
        teardown_attempts: 0,
    });
    workspace.open("fixture.txt", b"test").unwrap();
    let mut session = Some(workspace);

    assert!(close_session(&mut session).is_err());
    assert!(session.is_some());
    assert!(close_session(&mut session).is_ok());
    assert!(session.is_none());
}

#[test]
fn production_open_authorizes_after_guest_start_and_hands_bytes_to_workspace() {
    use std::sync::{Arc, Mutex};
    struct Runtime(Arc<Mutex<Vec<&'static str>>>);
    impl GuestRuntime for Runtime {
        type Error = &'static str;
        fn start(&mut self) -> Result<(), Self::Error> {
            self.0.lock().unwrap().push("start");
            Ok(())
        }
        fn ingress(&mut self, name: &str, bytes: &[u8]) -> Result<(), Self::Error> {
            assert_eq!(name, "document.pdf");
            assert_eq!(bytes, b"authorized");
            self.0.lock().unwrap().push("ingress");
            Ok(())
        }
        fn launch(&mut self, _: &str) -> Result<(), Self::Error> {
            self.0.lock().unwrap().push("launch");
            Ok(())
        }
        fn teardown(&mut self) -> Result<(), Self::Error> {
            Ok(())
        }
    }
    let order = Arc::new(Mutex::new(Vec::new()));
    let mut session = None;
    open_authorized_session(&mut session, Runtime(order.clone()), "document.pdf", || {
        order.lock().unwrap().push("authorize");
        Ok(b"authorized".to_vec())
    })
    .unwrap();
    assert_eq!(
        *order.lock().unwrap(),
        ["start", "authorize", "ingress", "launch"]
    );
    assert!(session.is_some());
}

#[test]
fn failed_open_cleanup_remains_owned_for_close_retry() {
    let mut session = None;
    let result = open_authorized_session(
        &mut session,
        RetryRuntime {
            teardown_attempts: 0,
        },
        "fixture.txt",
        || Err("authorization failed".into()),
    );
    assert_eq!(result.unwrap_err(), "workspace cleanup pending");
    assert!(session.is_some());
    assert!(close_session(&mut session).is_ok());
    assert!(session.is_none());
}
