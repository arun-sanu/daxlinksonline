module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setupEnv.cjs'],
  globalSetup: '<rootDir>/tests/globalSetup.cjs',
  globalTeardown: '<rootDir>/tests/globalTeardown.cjs',
  maxWorkers: 1,
  clearMocks: true,
  restoreMocks: true,
  detectOpenHandles: true,
  forceExit: false
};
