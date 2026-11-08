//! Agent skill bundled into the binary so installation works from any build.

use std::path::Path;

pub const SKILL_MD: &str = include_str!("../../skills/songhearth/SKILL.md");
const CLIENT_PY: &str = include_str!("../../skills/songhearth/scripts/songhearth.py");
const API_MD: &str = include_str!("../../skills/songhearth/reference/api.md");

pub fn install(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir.join("scripts"))?;
    std::fs::create_dir_all(dir.join("reference"))?;
    std::fs::write(dir.join("SKILL.md"), SKILL_MD)?;
    std::fs::write(dir.join("reference/api.md"), API_MD)?;
    let script = dir.join("scripts/songhearth.py");
    std::fs::write(&script, CLIENT_PY)?;
    crate::util::set_unix_mode(&script, 0o755)?;
    Ok(())
}
