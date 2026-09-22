use crate::schema::SCHEMA;
use rusqlite::Connection;

pub fn migrate(connection: &Connection) -> rusqlite::Result<()> {
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
            let start = SCHEMA
                .find(&format!("CREATE TABLE IF NOT EXISTS {table} ("))
                .unwrap();
            let definition = &SCHEMA[start..start + SCHEMA[start..].find(";").unwrap() + 1];
            connection.execute_batch(&format!(
                "BEGIN IMMEDIATE; ALTER TABLE {table} RENAME TO {table}_legacy; {definition} INSERT INTO {table} SELECT * FROM {table}_legacy; DROP TABLE {table}_legacy; COMMIT;"
            ))?;
        }
    }
    Ok(())
}
