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
