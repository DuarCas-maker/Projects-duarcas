import {readFile,writeFile} from "node:fs/promises";
import {createPrivateKey} from "node:crypto";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

// Import the downloaded PEM privately. Never print key material or tokens.
const args=process.argv.slice(2), value=flag=>args[args.indexOf(flag)+1];
try {
  if (!["--key-file","--id","--slug","--accounts"].every(flag=>args.includes(flag))) throw Error("Use --key-file PATH --id APP_ID --slug APP_SLUG --accounts LOGIN[,LOGIN] [--apply]");
  const id=value("--id"),slug=value("--slug"),accounts=value("--accounts");
  if (!/^[1-9]\d{0,14}$/.test(id) || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) || !accounts.split(",").every(x=>/^[a-zA-Z0-9-]{1,39}$/.test(x))) throw Error("Invalid app ID, slug or allowed accounts");
  const privateKey=(await readFile(resolve(value("--key-file")),"utf8")).trim();
  if (privateKey.length>16000 || createPrivateKey(privateKey).asymmetricKeyType!=="rsa") throw Error("Expected a valid RSA PEM private key");
  const target=resolve(".env.github-app.local");
  const ignored=spawnSync("git",["check-ignore","--quiet",target],{encoding:"utf8"});
  if (ignored.status!==0) throw Error("The destination must be ignored by Git");
  const text=`GITHUB_APP_ID=${id}\nGITHUB_APP_SLUG=${slug}\nGITHUB_ALLOWED_ACCOUNTS=${accounts}\nGITHUB_APP_PRIVATE_KEY=${JSON.stringify(privateKey)}\n`;
  if (args.includes("--apply")) await writeFile(target,text,{flag:"wx",mode:0o600});
  console.log(JSON.stringify({saved:args.includes("--apply"),file:target,appId:id,slug,accounts,keyValid:true,gitIgnored:true}));
} catch(error) {
  // Filesystem/crypto errors can contain unexpected details; do not echo them.
  console.error("GitHub configuration import failed.",error?.code === "EEXIST" ? "Private configuration already exists; preserve it." : "Check arguments, PEM file and ignored destination.");process.exitCode=1;
}
