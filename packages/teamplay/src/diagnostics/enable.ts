// 'teamplay/diagnostics/enable': loads diagnostics and switches them on right
// away, without a global flag or env var. Import it before 'teamplay' (the
// first import of the app entry) for complete counts. Tracing stays off
// unless a flag asks for it; call diagnostics.enable({ trace: true }) later.
import './startOnLoad.ts'
export * from './index.ts'
