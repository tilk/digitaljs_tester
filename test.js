
const tester = require('./tester.js');

const fix = new tester.TestFixture({i: 1}, {o: 1});

beforeAll(() => tester.synthFixture(fix, filename));

fix.testInterface();
fix.testFun(s => ({o: s.i}));

