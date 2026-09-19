const Database = require('better-sqlite3'); const db = new Database('../../auth.db'); console.log(db.prepare('SELECT account_id, meta FROM gemini_accounts').all());
