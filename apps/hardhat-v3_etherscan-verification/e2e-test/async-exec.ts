import { promisify } from "node:util"
import { exec } from "node:child_process"

export const asyncExec = promisify(exec)
