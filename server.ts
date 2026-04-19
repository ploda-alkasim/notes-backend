require('dotenv/config');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize Turso Client
const db = createClient({
  url: process.env.TURSO_DATABASE_URL as string,
  authToken: process.env.TURSO_AUTH_TOKEN as string,
});

const createTableSql = `
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  isFavorite INTEGER DEFAULT 0,
  isChecked INTEGER DEFAULT 0,
  orderIndex INTEGER DEFAULT 0
);`;

// Initialize the database asynchronously
(async () => {
  try {
    await db.execute(createTableSql);
    console.log('Turso notes table is ready.');
  } catch (error: any) {
    console.error('Failed to create notes table:', error.message);
    process.exit(1);
  }
})();

app.get('/', (_req: any, res: any) => {
  res.send('Notes API is running');
});

app.get('/notes', async (_req: any, res: any) => {
  try {
    const result = await db.execute('SELECT * FROM notes ORDER BY orderIndex');
    res.json(result.rows);
  } catch (error: any) {
    console.error('Failed to fetch notes:', error.message);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

app.post('/notes', async (req: any, res: any) => {
  const { title, content, isFavorite = 0, isChecked = 0, orderIndex = 0 } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }

  const sql = `INSERT INTO notes (title, content, isFavorite, isChecked, orderIndex)
               VALUES (?, ?, ?, ?, ?)`;
  const args = [title, content, Number(isFavorite), Number(isChecked), Number(orderIndex)];

  try {
    const result = await db.execute({ sql, args });

    const createdNote = {
      // LibSQL returns lastInsertRowid as a BigInt, so we convert it to a Number
      id: Number(result.lastInsertRowid), 
      title,
      content,
      isFavorite: Number(isFavorite),
      isChecked: Number(isChecked),
      orderIndex: Number(orderIndex),
    };

    res.status(201).json(createdNote);
  } catch (error: any) {
    console.error('Failed to create note:', error.message);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

app.put('/notes/reorder', async (req: any, res: any) => {
  const updates = req.body;

  if (!Array.isArray(updates)) {
    return res.status(400).json({ error: 'Request body must be an array of {id, orderIndex} objects' });
  }

  try {
    // LibSQL uses transactions via db.transaction()
    const transaction = await db.transaction('write');
    
    try {
      for (const item of updates) {
        if (!item || typeof item.id !== 'number' || typeof item.orderIndex !== 'number') {
          await transaction.rollback();
          return res.status(400).json({ error: 'Each update item must include numeric id and orderIndex' });
        }

        await transaction.execute({
          sql: 'UPDATE notes SET orderIndex = ? WHERE id = ?',
          args: [item.orderIndex, item.id],
        });
      }

      await transaction.commit();
      res.json({ success: true });
      
    } catch (transactionError: any) {
      await transaction.rollback();
      throw transactionError; // Bubble up to outer catch block
    }
    
  } catch (error: any) {
    console.error('Failed to reorder notes:', error.message);
    res.status(500).json({ error: 'Failed to reorder notes' });
  }
});

app.put('/notes/:id', async (req: any, res: any) => {
  const noteId = Number(req.params.id);
  const { title, content, isFavorite, isChecked, orderIndex } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }

  const sql = `UPDATE notes SET title = ?, content = ?, isFavorite = ?, isChecked = ?, orderIndex = ? WHERE id = ?`;
  const args = [title, content, Number(isFavorite ?? 0), Number(isChecked ?? 0), Number(orderIndex ?? 0), noteId];

  try {
    const result = await db.execute({ sql, args });

    // Use rowsAffected to check if the note existed
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    res.json({ 
      id: noteId, 
      title, 
      content, 
      isFavorite: Number(isFavorite ?? 0), 
      isChecked: Number(isChecked ?? 0), 
      orderIndex: Number(orderIndex ?? 0) 
    });
  } catch (error: any) {
    console.error('Failed to update note:', error.message);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

app.delete('/notes/:id', async (req: any, res: any) => {
  const noteId = Number(req.params.id);
  const sql = 'DELETE FROM notes WHERE id = ?';

  try {
    const result = await db.execute({ sql, args: [noteId] });

    // Use rowsAffected to check if the note existed
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete note:', error.message);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  // Gracefully close the Turso connection
  db.close();
  process.exit(0);
});