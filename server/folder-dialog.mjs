/**
 * Native folder picker for the project picker's "open folder" button:
 * spawns the OS dialog on the bridge's device and resolves the chosen
 * directory ({ path: null } when the user cancels the dialog).
 */
import { spawn } from "node:child_process";

/** One command line able to show a modal folder picker, per platform. */
function pickerCommand() {
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog;",
      "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }",
    ].join(" ");
    return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", script]];
  }
  if (process.platform === "darwin") {
    return ["osascript", ["-e", "POSIX path of (choose folder)"]];
  }
  if (process.platform === "linux") {
    return ["zenity", ["--file-selection", "--directory"]];
  }
  return null;
}

/** Resolve the folder chosen in the device's native dialog. */
export function pickFolder() {
  return new Promise((resolve, reject) => {
    const spec = pickerCommand();
    if (!spec) {
      reject(Object.assign(new Error(`no native folder picker on ${process.platform}`), { status: 500 }));
      return;
    }
    const [cmd, args] = spec;
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", (spawnErr) => {
      reject(Object.assign(new Error(`cannot open folder picker: ${spawnErr.message}`), { status: 500 }));
    });
    child.on("close", (code) => {
      const selected = out.trim();
      if (code === 0) {
        resolve({ path: selected || null, canceled: !selected });
        return;
      }
      // macOS osascript exits 1 with error -128 when the user cancels;
      // zenity exits 1 with no output for the same.
      if (/-128/.test(err) || (!selected && !err.trim())) {
        resolve({ path: null, canceled: true });
        return;
      }
      reject(Object.assign(new Error(err.trim() || `folder picker exited with code ${code}`), { status: 500 }));
    });
  });
}
