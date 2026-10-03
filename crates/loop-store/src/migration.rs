//! Legacy schema migration with row-preserving identifier widening.
//!
//! `SCHEMA` is a compile-time constant that evolves together with this
//! migration, so a table definition missing from the constant is a broken
//! build invariant. It is surfaced as an error instead of panicking.

use crate::schema::SCHEMA;
use rusqlite::Connection;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MigrationError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error("schema definition for table {table} is missing or malformed")]
    SchemaDefinitionMissing { table: String },
}

pub fn migrate(connection: &Connection) -> Result<(), MigrationError> {
    connection.execute_batch(SCHEMA)?;
    // These tables have no incoming foreign keys. Preserve their rows while
    // moving legacy global identifiers into the same run scope as tasks.
    for table in ["workers", "attention", "decisions", "artifacts"] {
        let keys: i64 = connection.query_row(
            &format!("SELECT count(*) FROM pragma_table_info('{table}') WHERE pk > 0"),
            [],
            |row| row.get(0),
        )?;
        if keys == 1 {
            let definition = table_definition(table)?;
            connection.execute_batch(&format!(
                "BEGIN IMMEDIATE; ALTER TABLE {table} RENAME TO {table}_legacy; {definition} INSERT INTO {table} SELECT * FROM {table}_legacy; DROP TABLE {table}_legacy; COMMIT;",
            ))?;
        }
    }
    Ok(())
}

/// Extract one table's `CREATE TABLE` statement from the schema constant.
fn table_definition(table: &str) -> Result<String, MigrationError> {
    let missing = || MigrationError::SchemaDefinitionMissing {
        table: table.to_string(),
    };
    let start = SCHEMA
        .find(&format!("CREATE TABLE IF NOT EXISTS {table} ("))
        .ok_or_else(missing)?;
    let end = SCHEMA[start..].find(';').ok_or_else(missing)?;
    Ok(SCHEMA[start..start + end + 1].to_string())
}
