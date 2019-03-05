"use strict";

const digitaljs = require('digitaljs');
const yosys2digitaljs = require('yosys2digitaljs');
const { Vector3vl } = require('3vl');

class TestFixture {
    constructor(ins, outs) {
        this.timeout = 100;
        this.circuit = null;
        this.inlist = Object.entries(ins).map(([net, bits]) => ({net: net, bits: bits}));
        this.outlist = [];
        this.ins = ins;
        this.outs = outs;
        this.net2name = {};
    }
    setCircuit(circ) {
        this.circuit = new digitaljs.HeadlessCircuit(circ);
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
                this.expectComb(ins, fun(ins));
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
                this.expectComb(ins, fun(ins));
            }
        });
    }
    testFun(fun, opts = {}) {
        const totbits = this.inlist.reduce((a, b) => a + b.bits, 0);
        if (totbits <= 6) this.testFunComplete(fun, opts);
        else this.testFunRandomized(fun, opts);
    }
    expectComb(ins1, outs) {
        const ins = Object.assign({}, ins1);
        const message = Object.entries(ins).map(([a, x]) => a + ':' + x.toBin()).join(' ') + ' ' + Object.entries(outs).map(([a, x]) => a + ':' + x.toBin()).join(' ');
        test(message, () => {
            try {
                for (const [name, value] of Object.entries(ins)) {
                    this.circuit.setInput(this.net2name[name], value);
                }
                for (let x = 0; x < this.timeout && this.circuit.hasPendingEvents; x++)
                    this.circuit.updateGates();
                for (const k in this.outlist) {
                    expect(this.circuit.getOutput(this.outlist[k].name).toBin())
                        .toEqual(outs[this.outlist[k].net].toBin());
                }
            } catch (e) {
                e.message = message + '\n' + e.message;
                throw e;
            }
        });
    }
}

async function synthFixture(fixture, filename) {
    fixture.setCircuit((await yosys2digitaljs.process([filename])).output);
}

exports.synthFixture = synthFixture;
exports.TestFixture = TestFixture;

