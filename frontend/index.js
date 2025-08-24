const passwordsDiv = document.getElementById('passwords');
const fileInput = document.getElementById('fileInput');
const output = document.getElementById('output');

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
  // TODO: integrate with backend or CLI
});
