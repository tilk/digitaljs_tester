"use strict";

const digitaljs = require('digitaljs');
const yosys2digitaljs = require('yosys2digitaljs');
const { Vector3vl } = require('3vl');

class TestFixture {
    constructor(ins, outs) {
        this.timeout = 100;
        this.circuit = null;
        this.circdesc = null;
        this.inlist = Object.entries(ins).map(([net, bits]) => ({net: net, bits: bits}));
        this.outlist = [];
        this.ins = ins;
        this.outs = outs;
        this.net2name = {};
    }
    setCircuit(circ) {
        this.circuit = new digitaljs.HeadlessCircuit(circ);
        this.circdesc = circ;
        this.inlist = [];
        this.outlist = [];
        this.net2name = {};
        for (const [name, celldata] of Object.entries(circ.devices)) {
            if (celldata.celltype == '$input')
                this.inlist.push({name: name, net: celldata.net, bits: celldata.bits});
            if (celldata.celltype == '$output')
                this.outlist.push({name: name, net: celldata.net, bits: celldata.bits});
            if (celldata.net)
                this.net2name[celldata.net] = name;
        }
    }
    testInterface() {
        test('toplevel module interface is correct', () => {
            const ioentry = (ioe) => [ioe.net, ioe.bits];
            expect(this.inlist.map(ioentry).sort()).toEqual(Object.entries(this.ins).sort());
            expect(this.outlist.map(ioentry).sort()).toEqual(Object.entries(this.outs).sort());
        });
    }
    testPrimitives(pprims, neg = false) {
        const prims = ['$input', '$output','$constant'];
        for (const p of pprims) {
            if (p == 'gate') {
                prims.push('$not','$and','$nand','$or','$nor','$xor','$xnor','$reduce_and','$reduce_nand','$reduce_or','$reduce_nor','$reduce_xor','$reduce_xnor','$reduce_bool','$logic_not','$repeater');
            } else if (p == 'arith') {
                prims.push('$shl','$shr','$lt','$le','$eq','$ne','$gt','$ge','$neg','$pos','$add','$sub','$mul','$div','$mod','$pow','$zeroextend','$signextend');
            } else if (p == 'mux') {
                prims.push('$mux','$pmux');
            } else if (p == 'dff') {
                prims.push('$dff');
            } else if (p == 'mem') {
                prims.push('$mem');
            } else if (p == 'bus') {
                prims.push('$busgroup','$busungroup','$busslice','$zeroextend','$signextend');
            } else prims.push(p);
        }
        test('only selected primitives are used', () => {
            function f(circ) {
                for (const [name, celldata] of Object.entries(circ)) {
                    if (celldata.celltype[0] == '$') {
                        if (neg) {
                            expect(prims).not.toContain(celldata.celltype);
                        } else {
                            expect(prims).toContain(celldata.celltype);
                        }
                    }
                }
            }
            f(this.circdesc.devices);
            for (const [name, circ] of Object.entries(this.circdesc.subcircuits))
                f(circ.devices);
        });
    }
    testFunRandomized(fun, opts) {
        const me = this;
        const randtrit = x => Math.floor(3 * Math.random() - 1);
        const randbit  = x => 2 * Math.floor(2 * Math.random()) - 1;
        const rand = (opts.no_x || opts.no_random_x) ? randbit : randtrit;
        function randtest() {
            const ret = {};
            for (const x of me.inlist) {
                ret[x.net] = Vector3vl.fromArray(Array(x.bits).fill(0).map(rand));
            }
            return ret;
        }
        function* gen(tries) { 
            for (const k of Array(tries).keys()) {
                yield randtest();
            }
        }
        describe("randomized logic table check", () => {
            for (const ins of gen(100)) {
                this.expectComb(ins, fun(ins), opts);
            }
        });
    }
    testFunComplete(fun, opts) {
        const me = this;
        const bitvals = opts.no_x ? [-1, 1] : [-1, 0, 1];
        function bitgen(n) {
            const bits = [];
            function* rec() {
                if (bits.length == n) yield bits;
                else {
                    for (const bit of bitvals) {
                        bits.push(bit);
                        yield* rec();
                        bits.pop();
                    } 
                }
            }
            return rec();
        }
        function gen() {
            const ins = {};
            function* rec(level) {
                if (level == me.inlist.length) yield ins;
                else {
                    for (const bits of bitgen(me.inlist[level].bits)) {
                        ins[me.inlist[level].net] = Vector3vl.fromArray(bits);
                        yield* rec(level+1);
                    }
                }
            }
            return rec(0);
        }
        describe("complete logic table check", () => {
            for (const ins of gen()) {
                this.expectComb(ins, fun(ins), opts);
            }
        });
    }
    testFun(fun, opts = {}) {
        const totbits = this.inlist.reduce((a, b) => a + b.bits, 0);
        if (totbits <= 6) this.testFunComplete(fun, opts);
        else this.testFunRandomized(fun, opts);
    }
    expectComb(ins1, outs, opts) {
        const ins = Object.assign({}, ins1);
        const message = Object.entries(ins).map(([a, x]) => a + ':' + x.toBin()).join(' ') + ' ' + Object.entries(outs).map(([a, x]) => a + ':' + x.toBin()).join(' ');
        const timeout = opts.timeout || this.timeout;
        function what(binstr) {
            if (opts.wildcard) return expect.stringMatching('^' + binstr.replace(/x/g, ".") + '$');
            else return binstr;
        }
        test(message, () => {
            for (const [name, value] of Object.entries(ins)) {
                this.circuit.setInput(this.net2name[name], value);
            }
            for (let x = 0; x < timeout && this.circuit.hasPendingEvents; x++)
                this.circuit.updateGates();
            expect(!this.circuit.hasPendingEvents).toBeTruthy();
            for (const k in this.outlist) {
                expect(this.circuit.getOutput(this.outlist[k].name).toBin())
                    .toEqual(what(outs[this.outlist[k].net].toBin()));
            }
        });
        if (opts.glitchtest) {
            test('Glitch test for ' + message, () => {
                for (const [name, value] of Object.entries(ins)) {
                    this.circuit.setInput(this.net2name[name], value);
                }
                for (let x = 0; x < timeout && this.circuit.hasPendingEvents; x++)
                    this.circuit.updateGates();
                expect(!this.circuit.hasPendingEvents).toBeTruthy();
                for (const [name, value] of Object.entries(ins)) {
                    if (value.bits == 0) continue;
                    for (let i = 0; i < value.bits; i++) {
                        this.circuit.setInput(this.net2name[name], value);
                        for (let x = 0; x < timeout && this.circuit.hasPendingEvents; x++)
                            this.circuit.updateGates();
                        expect(!this.circuit.hasPendingEvents).toBeTruthy();
                        const mask = Vector3vl.concat(Vector3vl.zeros(i), Vector3vl.one, Vector3vl.zeros(value.bits - 1 - i));
                        const outvals = {}, outmasks = {};
                        for (const k in this.outlist) {
                            outvals[k] = this.circuit.getOutput(this.outlist[k].name);
                            outmasks[k] = Vector3vl.zeros(outvals[k].bits);
                        }
                        this.circuit.setInput(this.net2name[name], value.xor(mask));
                        for (let x = 0; x < timeout && this.circuit.hasPendingEvents; x++) {
                            this.circuit.updateGates();
                            for (const k in this.outlist) {
                                const outval = this.circuit.getOutput(this.outlist[k].name);
                                const outmask = outval.xor(outvals[k]);
                                // look for second change in any output
                                expect(outmask.and(outmasks[k]).reduceOr().isHigh).toBeFalsy();
                                outvals[k] = outval;
                                outmasks[k] = outmasks[k].or(outmask);
                            }
                        }
                        expect(!this.circuit.hasPendingEvents).toBeTruthy();
                    }
                }
            });
        }
    }
}

async function synthFixture(fixture, filename) {
    fixture.setCircuit((await yosys2digitaljs.process([filename])).output);
}

exports.synthFixture = synthFixture;
exports.TestFixture = TestFixture;

