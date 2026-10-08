// Evaluated after install.ts and before the runtime modules index.ts imports
// (see enable.ts), so diagnostics count from the start.
import { startDiagnostics } from './install.ts'

startDiagnostics()
