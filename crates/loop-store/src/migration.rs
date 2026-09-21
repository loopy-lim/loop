use rusqlite::Connection;

use crate::schema::SCHEMA;

pub fn migrate(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(SCHEMA)
}
