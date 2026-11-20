const express = require("express");
const app = express();
app.use(express.json());

const { ROBLOX_API_KEY, GROUP_ID, ADMIN_PASSWORD } = process.env;
const MAX_RANK = parseInt(process.env.MAX_RANK || "254", 10); // nunca promove acima disso
const BASE = "https://apis.roblox.com/cloud/v2";
const H = { "x-api-key": ROBLOX_API_KEY, "Content-Type": "application/json" };

async function getRoles() {
  let roles = [], token = "";
  do {
    const r = await fetch(`${BASE}/groups/${GROUP_ID}/roles?maxPageSize=99${token ? "&pageToken=" + token : ""}`, { headers: H });
    if (!r.ok) throw new Error("Erro ao listar cargos: " + r.status + " " + (await r.text()));
    const j = await r.json();
    roles = roles.concat(j.groupRoles || []);
    token = j.nextPageToken;
  } while (token);
  return roles.sort((a, b) => a.rank - b.rank);
}

async function getUserIds(names) {
  const r = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: names, excludeBannedUsers: false }),
  });
  if (!r.ok) throw new Error("Erro ao buscar usuários: " + r.status);
  const j = await r.json();
  const map = {};
  for (const u of j.data) map[u.requestedUsername.toLowerCase()] = u;
  return map;
}

async function promote(name, user, roles) {
  if (!user) return { name, ok: false, msg: "Usuário não encontrado" };
  const filter = encodeURIComponent(`user == 'users/${user.id}'`);
  const r = await fetch(`${BASE}/groups/${GROUP_ID}/memberships?filter=${filter}`, { headers: H });
  if (!r.ok) return { name, ok: false, msg: "Erro ao buscar membro: " + r.status };
  const m = ((await r.json()).groupMemberships || [])[0];
  if (!m) return { name, ok: false, msg: "Não está no grupo" };

  const currentId = m.role.split("/").pop();
  const current = roles.find((x) => x.id === currentId);
  if (!current) return { name, ok: false, msg: "Cargo atual não encontrado" };
  const next = roles.find((x) => x.rank > current.rank && x.rank <= MAX_RANK);
  if (!next) return { name, ok: false, msg: `Já está no cargo máximo (${current.displayName})` };

  const p = await fetch(`${BASE}/${m.path}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify({ role: `groups/${GROUP_ID}/roles/${next.id}` }),
  });
  if (!p.ok) return { name, ok: false, msg: "Falha ao promover: " + p.status + " " + (await p.text()) };
  return { name, ok: true, msg: `${current.displayName} → ${next.displayName}` };
}

app.post("/api/promover", async (req, res) => {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) return res.status(401).json({ error: "Senha incorreta" });
  const names = [...new Set((req.body.names || []).map((n) => String(n).trim()).filter(Boolean))];
  if (!names.length) return res.status(400).json({ error: "Nenhum nome enviado" });
  try {
    const [roles, users] = await Promise.all([getRoles(), getUserIds(names)]);
    const results = [];
    for (const n of names) {
      results.push(await promote(n, users[n.toLowerCase()], roles));
      await new Promise((r) => setTimeout(r, 300)); // evita rate limit
    }
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (_, res) => res.type("html").send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Promover Grupo</title>
<style>
body{font-family:system-ui,sans-serif;background:#111;color:#eee;max-width:520px;margin:0 auto;padding:20px}
textarea,input,button{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #333;background:#1c1c1c;color:#eee;font-size:16px;margin-bottom:10px}
textarea{height:220px}button{background:#2563eb;border:0;font-weight:600;cursor:pointer}
button:disabled{opacity:.5}.ok{color:#4ade80}.err{color:#f87171}li{margin:6px 0}
</style></head><body>
<h2>Promover no grupo</h2>
<input id="pw" type="password" placeholder="Senha">
<textarea id="names" placeholder="Nome1&#10;Nome2"></textarea>
<button id="btn">Promover</button>
<ul id="out"></ul>
<script>
btn.onclick=async()=>{
  btn.disabled=true;out.innerHTML="<li>Processando...</li>";
  try{
    const r=await fetch("/api/promover",{method:"POST",
      headers:{"Content-Type":"application/json","x-admin-password":pw.value},
      body:JSON.stringify({names:names.value.split("\\n")})});
    const j=await r.json();
    out.innerHTML=j.error?'<li class="err">'+j.error+'</li>':
      j.results.map(x=>'<li class="'+(x.ok?'ok':'err')+'">'+(x.ok?'✅':'❌')+' '+x.name+' — '+x.msg+'</li>').join("");
  }catch(e){out.innerHTML='<li class="err">'+e.message+'</li>'}
  btn.disabled=false;
};
</script></body></html>`));

app.listen(process.env.PORT || 3000, () => console.log("Rodando"));
