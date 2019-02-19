
const tester = require('./tester.js');

const fix = new tester.TestFixture();

beforeAll(() => tester.synthFixture(fix, filename));

fix.testInterface({i: 1}, {o: 1});
fix.testFun(s => ({o: s.i}));

