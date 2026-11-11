// Preloaded into every emulator test process (`--import`, see the test:emulator script in package.json).
// node:test runs each test file in its own process. Giving each process its own Firebase project means the files
// can run side by side on one emulator: a file's resetEmulators() and its users, docs and rules are its project's
// alone. Scripts a test spawns inherit the project through GCLOUD_PROJECT, so they see the test's data.
if (process.env.NODE_TEST_CONTEXT && !process.env.ROADIE_TEST_PROJECT) {
  process.env.ROADIE_TEST_PROJECT = process.env.GCLOUD_PROJECT = `demo-roadie-${process.pid}`;
}
