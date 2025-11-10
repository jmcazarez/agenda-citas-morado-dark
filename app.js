const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('./db');

const app = express();
const PORT = 3000;

// --- Middlewares base ---
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: 'agenda-citas-secret',
    resave: false,
    saveUninitialized: false,
  })
);

// variables globales para las vistas
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// motor de vistas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Helper calendario ---
function generarCalendario(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  const firstWeekDay = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const weeks = [];
  let currentWeek = [];

  for (let i = 0; i < firstWeekDay; i++) {
    currentWeek.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const isoDate = date.toISOString().slice(0, 10);

    currentWeek.push({
      day,
      isoDate
    });

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push(currentWeek);
  }

  return weeks;
}

// --- Helper horarios cada 30 minutos ---
function generarHorarios() {
  const horarios = [];
  for (let h = 8; h <= 19; h++) {
    const base = String(h).padStart(2, '0');
    horarios.push(`${base}:00`);
    horarios.push(`${base}:30`);
  }
  return horarios;
}

// --- Middleware de protección ---
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// --- Rutas de autenticación ---

app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  db.get(
    'SELECT * FROM usuarios WHERE username = ? AND password = ?',
    [username, password],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.render('login', { error: 'Error al intentar iniciar sesión.' });
      }
      if (!row) {
        return res.render('login', { error: 'Usuario o contraseña incorrectos.' });
      }

      req.session.user = { id: row.id, username: row.username };
      res.redirect('/');
    }
  );
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/cambiar-pass', requireAuth, (req, res) => {
  res.render('cambiar-pass', { error: null, success: null });
});

app.post('/cambiar-pass', requireAuth, (req, res) => {
  const { actual, nueva } = req.body;
  const username = req.session.user.username;

  db.get(
    'SELECT * FROM usuarios WHERE username = ? AND password = ?',
    [username, actual],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.render('cambiar-pass', { error: 'Error al validar contraseña actual.', success: null });
      }
      if (!row) {
        return res.render('cambiar-pass', { error: 'La contraseña actual no es correcta.', success: null });
      }

      db.run(
        'UPDATE usuarios SET password = ? WHERE username = ?',
        [nueva, username],
        (err2) => {
          if (err2) {
            console.error(err2);
            return res.render('cambiar-pass', { error: 'Error al actualizar contraseña.', success: null });
          }
          res.render('cambiar-pass', { error: null, success: 'Contraseña actualizada correctamente.' });
        }
      );
    }
  );
});

// --- Catálogo de lugares ---
// Ver y agregar lugares
app.get('/lugares', requireAuth, (req, res) => {
  db.all('SELECT * FROM lugares ORDER BY nombre', (err, rows) => {
    if (err) {
      console.error(err);
      return res.send('Error consultando lugares');
    }
    res.render('lugares', { lugares: rows, error: null, success: null });
  });
});

app.post('/lugares', requireAuth, (req, res) => {
  const nombre = (req.body.nombre || '').trim();

  if (!nombre) {
    return db.all('SELECT * FROM lugares ORDER BY nombre', (err, rows) => {
      if (err) {
        console.error(err);
        return res.send('Error consultando lugares');
      }
      res.render('lugares', { lugares: rows, error: 'El nombre del lugar es obligatorio.', success: null });
    });
  }

  db.run(
    'INSERT INTO lugares (nombre) VALUES (?)',
    [nombre],
    (err) => {
      if (err) {
        console.error(err);
        const msg = err.message && err.message.includes('UNIQUE')
          ? 'El lugar ya existe en el catálogo.'
          : 'Error guardando el lugar.';
        return db.all('SELECT * FROM lugares ORDER BY nombre', (err2, rows) => {
          if (err2) {
            console.error(err2);
            return res.send('Error consultando lugares');
          }
          res.render('lugares', { lugares: rows, error: msg, success: null });
        });
      }

      db.all('SELECT * FROM lugares ORDER BY nombre', (err2, rows) => {
        if (err2) {
          console.error(err2);
          return res.send('Error consultando lugares');
        }
        res.render('lugares', { lugares: rows, error: null, success: 'Lugar agregado correctamente.' });
      });
    }
  );
});

// --- Rutas protegidas ---

// Calendario principal con conteo de citas por día
app.get('/', requireAuth, (req, res) => {
  const now = new Date();

  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;

  const weeks = generarCalendario(year, month);

  const monthStr = String(month).padStart(2, '0');
  const firstDateStr = `${year}-${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const lastDateStr = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  db.all(
    'SELECT fecha, COUNT(*) as total FROM citas WHERE fecha BETWEEN ? AND ? GROUP BY fecha',
    [firstDateStr, lastDateStr],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.send('Error consultando conteo de citas');
      }

      const citaCounts = {};
      rows.forEach(r => {
        citaCounts[r.fecha] = r.total;
      });

      res.render('calendar', {
        year,
        month,
        weeks,
        citaCounts
      });
    }
  );
});

app.get('/mes', requireAuth, (req, res) => {
  let { year, month } = req.query;
  year = parseInt(year);
  month = parseInt(month);

  if (!year || !month) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const weeks = generarCalendario(year, month);

  const monthStr = String(month).padStart(2, '0');
  const firstDateStr = `${year}-${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const lastDateStr = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  db.all(
    'SELECT fecha, COUNT(*) as total FROM citas WHERE fecha BETWEEN ? AND ? GROUP BY fecha',
    [firstDateStr, lastDateStr],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.send('Error consultando conteo de citas');
      }

      const citaCounts = {};
      rows.forEach(r => {
        citaCounts[r.fecha] = r.total;
      });

      res.render('calendar', {
        year,
        month,
        weeks,
        citaCounts
      });
    }
  );
});

// Citas por fecha
app.get('/citas', requireAuth, (req, res) => {
  const fecha = req.query.fecha;

  if (!fecha) {
    return res.redirect('/');
  }

  db.all(
    'SELECT * FROM citas WHERE fecha = ? ORDER BY hora',
    [fecha],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.send('Error consultando citas');
      }
      db.all('SELECT * FROM lugares ORDER BY nombre', (err2, lugares) => {
        if (err2) {
          console.error(err2);
          return res.send('Error consultando lugares');
        }
        res.render('citas', {
          fecha,
          citas: rows,
          horarios: generarHorarios(),
          lugares
        });
      });
    }
  );
});

// Crear cita con validación de duplicados
app.post('/citas', requireAuth, (req, res) => {
  const { nombre, telefono, lugar, fecha, hora } = req.body;

  db.get(
    'SELECT id FROM citas WHERE fecha = ? AND hora = ?',
    [fecha, hora],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.send('Error verificando citas existentes');
      }

      if (row) {
        return res.send(`
          <h3>Ya existe una cita registrada el ${fecha} a las ${hora}.</h3>
          <a href="/citas?fecha=${fecha}">Volver</a>
        `);
      }

      db.run(
        `INSERT INTO citas (nombre, telefono, lugar, fecha, hora)
         VALUES (?, ?, ?, ?, ?)`,
        [nombre, telefono, lugar, fecha, hora],
        (err2) => {
          if (err2) {
            console.error(err2);
            return res.send('Error guardando cita');
          }
          res.redirect('/citas?fecha=' + fecha);
        }
      );
    }
  );
});

// Editar cita con validación de duplicados
app.post('/citas/:id/editar', requireAuth, (req, res) => {
  const id = req.params.id;
  const { nombre, telefono, lugar, fecha, hora } = req.body;

  db.get(
    'SELECT id FROM citas WHERE fecha = ? AND hora = ? AND id != ?',
    [fecha, hora, id],
    (err, row) => {
      if (err) {
        console.error(err);
        return res.send('Error verificando duplicados');
      }

      if (row) {
        return res.send(`
          <h3>Ya existe otra cita registrada el ${fecha} a las ${hora}.</h3>
          <a href="/citas?fecha=${fecha}">Volver</a>
        `);
      }

      db.run(
        `UPDATE citas
         SET nombre = ?, telefono = ?, lugar = ?, fecha = ?, hora = ?
         WHERE id = ?`,
        [nombre, telefono, lugar, fecha, hora, id],
        (err2) => {
          if (err2) {
            console.error(err2);
            return res.send('Error actualizando cita');
          }
          res.redirect('/citas?fecha=' + fecha);
        }
      );
    }
  );
});

// Buscar citas
app.get('/buscar', requireAuth, (req, res) => {
  const termino = (req.query.q || '').trim();

  if (!termino) {
    return res.render('buscar', { citas: [], termino: '' });
  }

  const likeTerm = `%${termino}%`;

  db.all(
    `SELECT * FROM citas 
     WHERE nombre LIKE ? OR telefono LIKE ?
     ORDER BY fecha, hora`,
    [likeTerm, likeTerm],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.send('Error al buscar citas');
      }
      res.render('buscar', { citas: rows, termino });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
