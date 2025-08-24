const passwordsDiv = document.getElementById('passwords');
const fileInput = document.getElementById('fileInput');
const output = document.getElementById('output');
const terminal = document.getElementById('terminal');

function addPasswordField() {
  const idx = passwordsDiv.querySelectorAll('input').length + 1;
  const div = document.createElement('div');
  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = `Password #${idx}`;
  div.appendChild(input);
  passwordsDiv.appendChild(div);
}

document.getElementById('addPassword').addEventListener('click', addPasswordField);
for (let i = 0; i < 2; i++) addPasswordField();

document.getElementById('actionBtn').addEventListener('click', () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const file = fileInput.files[0];
  const passwords = Array.from(passwordsDiv.querySelectorAll('input')).map(i => i.value);
  output.textContent = `${mode} with ${passwords.length} password(s)` + (file ? ` on ${file.name}` : '');
  terminal.innerHTML = '';
  const messages = [
    `$ ${mode}${file ? ' ' + file.name : ''}`,
    'STEP #1 zip ... [1]',
    'STEP #2 encrypt ... [1]',
    'STEP #3 chunk & queue jobs ... [1]',
    'STEP #4 encode QR in parallel ... [1]',
    'Done.'
  ];
  let idx = 0;
  function log(msg) {
    const line = document.createElement('div');
    line.textContent = msg;
    line.className = 'line';
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
  }
  function next() {
    if (idx < messages.length) {
      log(messages[idx++]);
      setTimeout(next, 500);
    }
  }
  next();
  // TODO: integrate with backend or CLI
});
