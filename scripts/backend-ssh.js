const { Client } = require('ssh2');

const host = process.env.BACKEND_SSH_HOST || '14.103.219.42';
const username = process.env.BACKEND_SSH_USER || 'root';
const password = process.env.BACKEND_SSH_PASSWORD;
const command = process.argv.slice(2).join(' ');

if (!password) {
  console.error('BACKEND_SSH_PASSWORD is not set. Use scripts/connect-backend.ps1 for password prompt.');
  process.exit(1);
}

const conn = new Client();

conn
  .on('ready', () => {
    if (command) {
      conn.exec(command, (err, stream) => {
        if (err) throw err;
        stream
          .on('close', (code) => {
            conn.end();
            process.exitCode = code || 0;
          })
          .on('data', data => process.stdout.write(data));
        stream.stderr.on('data', data => process.stderr.write(data));
      });
      return;
    }

    conn.shell((err, stream) => {
      if (err) throw err;
      if (process.stdin.setRawMode) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.pipe(stream);
      stream.pipe(process.stdout);
      stream.stderr?.pipe(process.stderr);
      stream.on('close', () => {
        if (process.stdin.setRawMode) process.stdin.setRawMode(false);
        conn.end();
      });
    });
  })
  .on('error', (err) => {
    console.error(`SSH connection failed: ${err.message}`);
    process.exitCode = 1;
  })
  .connect({
    host,
    port: Number(process.env.BACKEND_SSH_PORT || 22),
    username,
    password,
    readyTimeout: 20000
  });
