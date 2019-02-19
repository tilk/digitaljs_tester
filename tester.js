"use strict";

const digitaljs = require('digitaljs');
const yosys2digitaljs = require('yosys2digitaljs');
const { Vector3vl } = require('3vl');

class TestFixture {
    constructor() {
        this.timeout = 100;
        this.circuit = null;
        this.inlist = [];
        this.outlist = [];
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
    testInterface(inlist, outlist) {
        test('toplevel module interface is correct', () => {
            const ioentry = (ioe) => [ioe.net, ioe.bits];
            expect(this.inlist.map(ioentry).sort()).toEqual(Object.entries(inlist).sort());
            expect(this.outlist.map(ioentry).sort()).toEqual(Object.entries(outlist).sort());
        });
    }
    testFunRandomized(fun, opts) {
        const me = this;
        const randtrit = x => Math.floor(3 * Math.random() - 1);
        const randbit  = x => 2 * Math.floor(2 * Math.random()) - 1;
        const rand = opts.no_random_x ? randbit : randtrit;
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
        test("randomized logic table check", () => {
            for (const ins of gen(100)) {
                this.expectComb(ins, fun(ins));
            }
        });
    }
    testFunComplete(fun) {
        const me = this;
        function bitgen(n) {
            const bits = [];
            function* rec() {
                if (bits.length == n) yield bits;
                else {
                    for (const bit of [-1, 0, 1]) {
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
        test("complete logic table check", () => {
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
    expectComb(ins, outs) {
        try {
            for (const [name, value] of Object.entries(ins)) {
                this.circuit.setInput(this.net2name[name], value);
            }
            for (let x = 0; x < this.timeout && this.circuit.hasPendingEvents; x++)
                this.circuit.updateGates();
            expect(this.circuit.hasPendingEvents).toBeFalsy();
            for (const k in this.outlist) {
                expect(this.circuit.getOutput(this.outlist[k].name).toBin())
                    .toEqual(outs[this.outlist[k].net].toBin());
            }
        } catch (e) {
            e.message = Object.entries(ins).map(([a, x]) => a + ':' + x.toBin()).join(' ') + ' ' + Object.entries(outs).map(([a, x]) => a + ':' + x.toBin()).join(' ') + '\n' + e.message;
            throw e;
        }
    }
}

async function synthFixture(fixture, filename) {
    fixture.setCircuit((await yosys2digitaljs.process([filename])).output);
}

exports.synthFixture = synthFixture;
exports.TestFixture = TestFixture;

