use std::path::PathBuf;

use loop_bridge::loop_package;

fn main() -> rustra::Result<()> {
    let output = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "packages/protocol/src/generated".into());
    loop_package()
        .generate_typescript()?
        .write_schema_to_dir(PathBuf::from(output))?;
    Ok(())
}
