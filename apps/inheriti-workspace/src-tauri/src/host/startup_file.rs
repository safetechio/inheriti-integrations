use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(super) struct StartupFile(PathBuf);

impl StartupFile {
    pub(super) fn from_secondary_args(args: &[String], cwd: &str) -> Result<Option<Self>, String> {
        if args.len() == 1 {
            return Ok(None);
        }
        if args.len() != 2 {
            return Err("invalid_startup_file".into());
        }
        let path = PathBuf::from(&args[1]);
        let path = if path.is_absolute() {
            path
        } else {
            Path::new(cwd).join(path)
        };
        Self::from_path(path).map(Some)
    }

    pub(super) fn from_args(
        mut args: impl Iterator<Item = std::ffi::OsString>,
    ) -> Result<Option<Self>, String> {
        let Some(path) = args.next() else {
            return Ok(None);
        };
        if args.next().is_some() {
            return Err("invalid_startup_file".into());
        }
        Self::from_path(PathBuf::from(path)).map(Some)
    }

    pub(super) fn from_path(path: PathBuf) -> Result<Self, String> {
        if path
            .extension()
            .is_none_or(|extension| !extension.to_string_lossy().eq_ignore_ascii_case("inheriti"))
        {
            return Err("invalid_startup_file".into());
        }
        let metadata = std::fs::symlink_metadata(&path).map_err(|_| "invalid_startup_file")?;
        if !metadata.file_type().is_file()
            || metadata.len() == 0
            || metadata.len() > 64 * 1024 * 1024
        {
            return Err("invalid_startup_file".into());
        }
        Ok(Self(path))
    }

    pub(super) fn as_path(&self) -> &Path {
        &self.0
    }
}
