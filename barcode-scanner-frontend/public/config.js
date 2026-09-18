// Runtime configuration. Deliberately empty in the repo: `npm start` and jest
// read REACT_APP_* from process.env instead. The production image overwrites
// this file at container start from its environment
// (docker/runtime-config.sh), and src/config/runtimeEnv.js layers it over the
// build-time values. Never put secrets here: every visitor can fetch it.
window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};
