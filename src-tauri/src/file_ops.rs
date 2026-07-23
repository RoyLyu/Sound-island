use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileExport {
    output_path: String,
    bytes_copied: u64,
}

pub fn copy_sound(input_path: &Path, output_path: &Path) -> Result<FileExport> {
    let input = input_path.canonicalize().context("所选音频不存在")?;
    if !input.is_file() {
        bail!("所选路径不是音频文件");
    }
    let output_parent = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .canonicalize()
        .context("导出目录不存在或不可写")?;
    let output_name = output_path.file_name().context("导出文件名无效")?;
    let output = output_parent.join(output_name);
    if input == output {
        bail!("导出副本不能覆盖原始音频");
    }
    let bytes_copied = std::fs::copy(&input, &output).context("复制所选音频失败")?;
    Ok(FileExport {
        output_path: output.to_string_lossy().into_owned(),
        bytes_copied,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn copies_without_modifying_source() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let source = std::env::temp_dir().join(format!("sound-island-copy-source-{suffix}.wav"));
        let output = std::env::temp_dir().join(format!("sound-island-copy-output-{suffix}.wav"));
        std::fs::write(&source, b"sound-island-copy-test").unwrap();
        let before = std::fs::read(&source).unwrap();
        let result = copy_sound(&source, &output).unwrap();
        assert_eq!(result.bytes_copied, before.len() as u64);
        assert_eq!(std::fs::read(&output).unwrap(), before);
        assert_eq!(std::fs::read(&source).unwrap(), before);
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(output);
    }

    #[test]
    fn refuses_to_overwrite_source() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        let error = copy_sound(&path, &path).unwrap_err().to_string();
        assert!(error.contains("不能覆盖原始音频"));
    }
}
