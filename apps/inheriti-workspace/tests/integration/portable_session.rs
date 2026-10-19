//! Portable contract for authorized file admission into one disposable session.
//! The fake runtime observes bytes and lifecycle calls; platform VM tests own isolation proof.

use inheriti_workspace::{
    access::handoff::{HandoffError, HandoffFailure},
    session::{GuestRuntime, Workspace},
};
use serde::Deserialize;
use std::{cell::RefCell, fs, path::PathBuf, rc::Rc};

#[derive(Deserialize)]
struct Manifest {
    schema: u8,
    files: Vec<Fixture>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    file: String,
    bytes: usize,
    expected: Expected,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    portable_session_admission: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Event {
    Start,
    Ingress(String, Vec<u8>),
    Launch(String),
    Teardown,
}

struct RecordingRuntime(Rc<RefCell<Vec<Event>>>);

impl GuestRuntime for RecordingRuntime {
    type Error = ();

    fn start(&mut self) -> Result<(), Self::Error> {
        self.0.borrow_mut().push(Event::Start);
        Ok(())
    }

    fn ingress(&mut self, name: &str, bytes: &[u8]) -> Result<(), Self::Error> {
        self.0
            .borrow_mut()
            .push(Event::Ingress(name.to_owned(), bytes.to_vec()));
        Ok(())
    }

    fn launch(&mut self, name: &str) -> Result<(), Self::Error> {
        self.0.borrow_mut().push(Event::Launch(name.to_owned()));
        Ok(())
    }

    fn teardown(&mut self) -> Result<(), Self::Error> {
        self.0.borrow_mut().push(Event::Teardown);
        Ok(())
    }
}

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures")
}

fn corpus() -> (PathBuf, Manifest) {
    let root = fixture_root();
    let manifest = serde_json::from_slice::<Manifest>(
        &fs::read(root.join("manifest.json")).expect("read corpus manifest"),
    )
    .expect("parse corpus manifest");
    assert_eq!(manifest.schema, 1);
    (root, manifest)
}

#[test]
fn all_corpus_files_enter_one_authorized_session_as_opaque_bytes() {
    let (root, manifest) = corpus();
    assert!(!manifest.files.is_empty());
    let events = Rc::new(RefCell::new(Vec::new()));
    let mut workspace = Workspace::new(RecordingRuntime(Rc::clone(&events)));
    let mut expected = vec![Event::Start];
    let mut authorizations = 0;

    for (index, fixture) in manifest.files.iter().enumerate() {
        assert!(
            fixture.expected.portable_session_admission,
            "{}",
            fixture.file
        );
        let bytes = fs::read(root.join(&fixture.file)).expect("read corpus file");
        assert_eq!(bytes.len(), fixture.bytes, "{}", fixture.file);
        let name = fixture.file.as_str();
        let authorize = || {
            // Opening starts the guest before requesting access. Later admissions
            // happen after the preceding file has been delivered and launched.
            assert_eq!(*events.borrow(), expected);
            authorizations += 1;
            Ok::<_, ()>(bytes.clone())
        };
        if index == 0 {
            workspace.open_authorized(name, authorize).unwrap();
        } else {
            workspace.admit_authorized(name, authorize).unwrap();
        }
        expected.push(Event::Ingress(name.to_owned(), bytes));
        expected.push(Event::Launch(name.to_owned()));
        assert_eq!(*events.borrow(), expected);
    }

    assert_eq!(authorizations, manifest.files.len());
    workspace.close().unwrap();
    expected.push(Event::Teardown);
    assert_eq!(*events.borrow(), expected);
    drop(workspace);
    assert_eq!(*events.borrow(), expected, "close must not repeat teardown");
}

#[test]
fn denied_second_file_cleans_up_without_ingress() {
    let (root, manifest) = corpus();
    assert!(manifest.files.len() >= 2);
    let first = &manifest.files[0];
    let second = &manifest.files[1];
    let events = Rc::new(RefCell::new(Vec::new()));
    let mut workspace = Workspace::new(RecordingRuntime(Rc::clone(&events)));
    workspace
        .open_authorized(&first.file, || {
            Ok::<_, ()>(fs::read(root.join(&first.file)).unwrap())
        })
        .unwrap();
    let mut expected = events.borrow().clone();
    let denied = workspace.admit_authorized(&second.file, || Err::<Vec<u8>, _>("denied"));
    assert_eq!(
        denied,
        Err(HandoffError::Failure(HandoffFailure::Authorization(
            "denied"
        )))
    );
    expected.push(Event::Teardown);
    assert_eq!(*events.borrow(), expected);
    assert!(workspace.close().is_ok());
    assert_eq!(*events.borrow(), expected);
}
