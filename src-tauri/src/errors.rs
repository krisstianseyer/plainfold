use std::fmt;

/// An error whose message is safe to show to the user.
#[derive(Debug, Clone)]
pub struct AppError {
    pub message: String,
}

impl AppError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::new(io_message(&value))
    }
}

pub type AppResult<T> = Result<T, AppError>;

pub fn io_message(error: &std::io::Error) -> String {
    use std::io::ErrorKind;
    match error.kind() {
        ErrorKind::NotFound => "The file or folder no longer exists.".into(),
        ErrorKind::PermissionDenied => "Permission was denied.".into(),
        ErrorKind::AlreadyExists => "That item already exists.".into(),
        ErrorKind::InvalidInput | ErrorKind::InvalidData => {
            "The file or folder name is not valid.".into()
        }
        _ => "The operation could not be completed.".into(),
    }
}
