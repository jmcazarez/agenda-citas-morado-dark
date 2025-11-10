const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'citas.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error abriendo la base de datos', err);
  } else {
    console.log('Base de datos SQLite lista:', dbPath);
  }
});

db.serialize(() => {
  // Tabla de citas
  db.run(
    `CREATE TABLE IF NOT EXISTS citas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      telefono TEXT,
      lugar TEXT,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL
    )`,
    (err) => {
      if (err) {
        console.error('Error creando tabla citas:', err);
      }
    }
  );

  // Tabla de usuarios
  db.run(
    `CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )`,
    (err) => {
      if (err) {
        console.error('Error creando tabla usuarios:', err);
      } else {
        // Usuario por defecto
        db.get(
          'SELECT * FROM usuarios WHERE username = ?',
          ['paulina'],
          (err, row) => {
            if (err) {
              console.error('Error consultando usuario por defecto:', err);
            } else if (!row) {
              db.run(
                'INSERT INTO usuarios (username, password) VALUES (?, ?)',
                ['paulina', 'psanchez'],
                (err) => {
                  if (err) {
                    console.error('Error insertando usuario por defecto:', err);
                  } else {
                    console.log('Usuario por defecto creado: paulina / psanchez');
                  }
                }
              );
            }
          }
        );
      }
    }
  );

  // Tabla de lugares (catálogo)
  db.run(
    `CREATE TABLE IF NOT EXISTS lugares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL
    )`,
    (err) => {
      if (err) {
        console.error('Error creando tabla lugares:', err);
      } else {
        // Insertar lugares por defecto si está vacío
        db.get('SELECT COUNT(*) AS count FROM lugares', (err2, row) => {
          if (err2) {
            console.error('Error contando lugares:', err2);
          } else if (row.count === 0) {
            db.run(
              'INSERT INTO lugares (nombre) VALUES (?), (?)',
              ['Valle Alto', 'Lomas'],
              (err3) => {
                if (err3) {
                  console.error('Error insertando lugares por defecto:', err3);
                } else {
                  console.log('Lugares por defecto creados: Valle Alto, Lomas');
                }
              }
            );
          }
        });
      }
    }
  );
});

module.exports = db;
