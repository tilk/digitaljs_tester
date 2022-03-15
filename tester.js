"use strict";

const digitaljs = require('digitaljs');

const yosys2digitaljs = require('yosys2digitaljs');
const { Vector3vl } = require('3vl');
const topsort = require('topsort');

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
        this.interface_ok = false;
    }
    setCircuit(circ) {
        this.circuit = new digitaljs.HeadlessCircuit(circ);
        this.circdesc = circ;
        this.inlist = [];
        this.outlist = [];
        this.net2name = {};
        for (const [name, celldata] of Object.entries(circ.devices)) {
            if (celldata.type == 'Input')
                this.inlist.push({name: name, net: celldata.net, bits: celldata.bits});
            if (celldata.type == 'Output')
                this.outlist.push({name: name, net: celldata.net, bits: celldata.bits});
            if (celldata.net)
                this.net2name[celldata.net] = name;
        }
        // test if interface ok
        const ioentry = (ioe) => [ioe.net, ioe.bits];
        this.interface_ok = true;
        if (this.inlist.map(ioentry).sort().toString() != Object.entries(this.ins).sort().toString())
            this.interface_ok = false;
        if (this.outlist.map(ioentry).sort().toString() != Object.entries(this.outs).sort().toString())
            this.interface_ok = false;
    }
    setInput(port, value) {
        if (!this.interface_ok) return;
        this.circuit.setInput(this.net2name[port], value)
    }
    getOutput(port) {
        if (!this.interface_ok) return;
        return this.circuit.getOutput(this.net2name[port]);
    }
    reset(port, polarity) {
        if (!this.interface_ok) return;
        this.circuit.setInput(this.net2name[port], Vector3vl.fromBool(polarity));
        this.waitUntilStable(1000);
        this.circuit.setInput(this.net2name[port], Vector3vl.fromBool(!polarity));
        this.waitUntilStable(1000);
    }
    testInterface() {
        test('REQUIRED: toplevel module interface is correct', () => {
            const ioentry = (ioe) => [ioe.net, ioe.bits];
            expect(this.inlist.map(ioentry).sort()).toEqual(Object.entries(this.ins).sort());
            expect(this.outlist.map(ioentry).sort()).toEqual(Object.entries(this.outs).sort());
        });
    }
    testPrimitives(pprims, neg = false) {
        const prims = ['Input', 'Output','Constant'];
        for (const p of pprims) {
            if (p == 'gate') {
                prims.push('Not','And','Nand','Or','Nor','Xor','Xnor','AndReduce','NandReduce','OrReduce','NorReduce','XorReduce','XnorReduce','Repeater','Eq','Ne');
            } else if (p == 'arith') {
                prims.push('ShiftLeft','ShiftRight','Lt','Le','Eq','Ne','Gt','Ge','Negation','UnaryPlus','Addition','Subtraction','Multiplication','Division','Modulo','Power','ZeroExtend','SignExtend');
            } else if (p == 'mux') {
                prims.push('Mux','Mux1Hot','Eq','Ne');
            } else if (p == 'dff') {
                prims.push('Dff');
            } else if (p == 'mem') {
                prims.push('Memory');
            } else if (p == 'bus') {
                prims.push('BusGroup','BusUngroup','BusSlice','ZeroExtend','SignExtend');
            } else prims.push(p);
        }
        test('REQUIRED: only selected primitives are used', () => {
            const f = (circ) => {
                for (const [name, celldata] of Object.entries(circ)) {
                    if (celldata.type != 'Subcircuit') {
                        if (neg) {
                            expect(prims).not.toContain(celldata.type);
                        } else {
                            expect(prims).toContain(celldata.type);
                        }
                    }
                }
            };
            f(this.circdesc.devices);
            for (const [name, circ] of Object.entries(this.circdesc.subcircuits))
                f(circ.devices);
        });
    }
    testMemoryPorts(readports, writeports, readtype = null) {
        const readtype_msg = (readtype == "sync") ? 'with synchronous read ' :
                             (readtype == "async") ? 'with asynchronous read ' : '';
        test('REQUIRED: only memories with at most ' + readports + ' read ports and at most ' + writeports + ' write ports ' + readtype_msg + 'are allowed', () => {
            const f = (circ) => {
                for (const [name, celldata] of Object.entries(circ)) {
                    if (celldata.type == 'Memory') {
                        expect((celldata.rdports || []).length).toBeLessThanOrEqual(readports);
                        expect((celldata.wrports || []).length).toBeLessThanOrEqual(writeports);
                        if (readtype) {
                            for (const rdport of celldata.rdports) {
                                if (readtype == "sync")
                                    expect('clock_polarity' in rdport).toBeTruthy();
                                if (readtype == "async")
                                    expect('clock_polarity' in rdport).toBeFalsy();
                            }
                        }
                    }
                }
            };
            f(this.circdesc.devices);
            for (const [name, circ] of Object.entries(this.circdesc.subcircuits))
                f(circ.devices);
        });
    }
    waitUntilStable(timeout) {
        for (let x = 0; x < timeout && this.circuit.hasPendingEvents; x++)
            this.circuit.updateGates();
        expect(!this.circuit.hasPendingEvents).toBeTruthy();
    }
    clockPulse(clk, timeout, clockTestPolarity = false) {
        this.waitUntilStable(timeout);
        this.circuit.setInput(this.net2name[clk], Vector3vl.zero);
        this.waitUntilStable(timeout);
        this.circuit.setInput(this.net2name[clk], Vector3vl.one);
        this.waitUntilStable(timeout);
        if (clockTestPolarity) {
            this.circuit.setInput(this.net2name[clk], Vector3vl.zero);
            this.waitUntilStable(timeout);
        }
    }
    circuitOutputs() {
        let ret = {};
        for (const k in this.outlist) {
            ret[this.outlist[k].net] = this.circuit.getOutput(this.outlist[k].name);
        }
        return ret;
    }
    testCriticalPath(timeout) {
        test('REQUIRED: critical path is at most ' + timeout, () => {
            this.interfacePrereq();
            for (const x of this.inlist) {
                this.circuit.setInput(this.net2name[x.net], Vector3vl.xes(x.bits));
            }
            this.waitUntilStable(timeout);
            for (const x of this.inlist) {
                this.circuit.setInput(this.net2name[x.net], Vector3vl.ones(x.bits));
            }
            this.waitUntilStable(timeout);
            for (const x of this.inlist) {
                this.circuit.setInput(this.net2name[x.net], Vector3vl.xes(x.bits));
            }
            this.waitUntilStable(timeout);
            for (const x of this.inlist) {
                this.circuit.setInput(this.net2name[x.net], Vector3vl.zeros(x.bits));
            }
            this.waitUntilStable(timeout);
        });
    }
    testCriticalPathAcyclic(timeout) {
        const gr = [];
        const pr = {};
        function addConn(i, o, prop) {
            gr.push([i, o]);
            if (pr[o] === undefined) pr[o] = {};
            pr[o][i] = prop;
        }
        function constructGraph(graph, prefix) {
            for (const elem of graph.getElements()) {
                if (elem.get('type') != 'Subcircuit') {
                    const prop = elem.get('propagation');
                    for (const il of graph.getConnectedLinks(elem, {inbound: true}))
                        for (const ol of graph.getConnectedLinks(elem, {outbound: true}))
                            addConn(prefix + il.get('id'), prefix + ol.get('id'), prop);
                } else {
                    const iomap = elem.get('circuitIOmap');
                    const gprefix = prefix + elem.get('id') + '&';
                    const ggraph = elem.get('graph');
                    constructGraph(ggraph, gprefix);
                    for (const il of graph.getConnectedLinks(elem, {inbound: true}))
                        for (const ol of ggraph.getConnectedLinks(ggraph.getCell(iomap[il.get('target').port]), {outbound: true}))
                            addConn(prefix + il.get('id'), gprefix + ol.get('id'), 0);
                    for (const ol of graph.getConnectedLinks(elem, {outbound: true}))
                        for (const il of ggraph.getConnectedLinks(ggraph.getCell(iomap[ol.get('source').port]), {inbound: true}))
                            addConn(gprefix + il.get('id'), prefix + ol.get('id'), 0);
                }
            }
        }
        test('REQUIRED: critical path is at most ' + timeout, () => {
            this.interfacePrereq();
            const graph = this.circuit._graph;
            constructGraph(graph, '');
            const toporder = (function() { 
                try {
                    return topsort(gr);
                } catch (exc) {
                    throw new Error('Circuit is not acyclic');
                }
            })();
            const cp = {};
            for (const elem of graph.getElements()) {
                if (elem.get('type') == 'Output')
                    for (const il of graph.getConnectedLinks(elem, {inbound: true}))
                        cp[il.get('id')] = 0;
            }
            for (const id of toporder) {
                if (cp[id] === undefined) cp[id] = 0;
                for (const i in pr[id]) {
                    cp[id] = Math.max(cp[id], pr[id][i] + cp[i]);
                }
            }
            for (const elem of graph.getElements()) {
                if (elem.get('type') == 'Output')
                    for (const il of graph.getConnectedLinks(elem, {inbound: true}))
                        expect(cp[il.get('id')]).toBeLessThanOrEqual(timeout);
            }
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
                if (x.net == opts.clock) continue;
                if (opts.fixed && opts.fixed[x.net]) ret[x.net] = opts.fixed[x.net];
                else ret[x.net] = Vector3vl.fromArray(Array(x.bits).fill(0).map(rand));
            }
            return ret;
        }
        function* gen(tries) {
            while (tries) {
                const rt = randtest();
                if (opts.precondition && !opts.precondition(rt)) continue;
                tries--;
                yield rt;
            }
        }
        describe("randomized logic table check", () => {
            for (const ins of gen(100)) {
                this.expect(ins, fun, opts);
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
                if (level == me.inlist.length) {
                    if (!opts.precondition || opts.precondition(ins))
                        yield ins;
                } else if (me.inlist[level].net == opts.clock) {
                    yield* rec(level+1);
                } else if (opts.fixed && opts.fixed[me.inlist[level].net]) {
                    ins[me.inlist[level].net] = opts.fixed[me.inlist[level].net];
                    yield* rec(level+1);
                } else {
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
                this.expect(ins, fun, opts);
            }
        });
    }
    testFun(fun, opts = {}) {
        const totbits = this.inlist.reduce((a, b) => a + b.bits, 0);
        if (totbits <= (opts.max_complete || 6)) this.testFunComplete(fun, opts);
        else this.testFunRandomized(fun, opts);
    }
    expect(ins1, fun, opts) {
        function what(binstr) {
            if (opts.wildcard) return expect.stringMatching('^' + binstr.replace(/x/g, ".") + '$');
            else return binstr;
        }
        const timeout = opts.timeout || this.timeout;
        const ins = Object.assign({}, ins1);
        if (!opts.clock) {
            const outs = fun(ins);
            const message = Object.entries(ins).map(([a, x]) => a + ':' + x.toBin()).join(' ') + ' ' + Object.entries(outs).map(([a, x]) => a + ':' + x.toBin()).join(' ');
            test(message, () => {
                this.interfacePrereq();
                for (const [name, value] of Object.entries(ins)) {
                    this.circuit.setInput(this.net2name[name], value);
                }
                this.waitUntilStable(timeout);
                for (const k in this.outlist) {
                    expect(this.circuit.getOutput(this.outlist[k].name).toBin())
                        .toEqual(what(outs[this.outlist[k].net].toBin()));
                }
            });
            if (opts.glitchtest) {
                test('Glitch test for ' + message, () => {
                    this.interfacePrereq();
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
                            this.waitUntilStable(timeout);
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
        } else if (opts.algo) {
            const outs = fun(ins);
            const cycle_timeout = opts.algo.timeout || 100;
            const message = Object.entries(ins).filter(([a,x]) => a != opts.clock && a != opts.algo.start).map(([a, x]) => a + ':' + x.toBin()).join(' ') + ' ' + Object.entries(outs).filter(([a, x]) => a != opts.algo.ready).map(([a, x]) => a + ':' + x.toBin()).join(' ');
            test(message, () => {
                this.interfacePrereq();
                expect(this.circuit.getOutput(this.net2name[opts.algo.ready]).toBin()).toEqual(Vector3vl.one.toBin());
                for (const [name, value] of Object.entries(ins)) {
                    this.circuit.setInput(this.net2name[name], value);
                }
                this.circuit.setInput(this.net2name[opts.algo.start], Vector3vl.one);
                this.clockPulse(opts.clock, timeout);
                this.circuit.setInput(this.net2name[opts.algo.start], Vector3vl.zero);
                for (let i = 0; i < cycle_timeout && this.circuit.getOutput(this.net2name[opts.algo.ready]).isLow; i++) {
                    this.clockPulse(opts.clock, timeout);
                }
                expect(this.circuit.getOutput(this.net2name[opts.algo.ready]).toBin()).toEqual(Vector3vl.one.toBin());
                for (const k in this.outlist) {
                    if (this.outlist[k].net == opts.algo.ready) continue;
                    expect([this.outlist[k].net, this.circuit.getOutput(this.outlist[k].name).toBin()])
                        .toEqual([this.outlist[k].net, what(outs[this.outlist[k].net].toBin())]);
                }
            });
        } else {
            const message = Object.entries(ins).filter(([a,x]) => a != opts.clock).map(([a, x]) => a + ':' + x.toBin()).join(' ');
            test(message, () => {
                this.interfacePrereq();
                const outs = fun(ins, this.circuitOutputs());
                for (const [name, value] of Object.entries(ins)) {
                    this.circuit.setInput(this.net2name[name], value);
                }
                this.clockPulse(opts.clock, timeout, opts.clockTestPolarity);
                for (const k in this.outlist) {
                    expect([this.outlist[k].net, this.circuit.getOutput(this.outlist[k].name).toBin()])
                        .toEqual([this.outlist[k].net, what(outs[this.outlist[k].net].toBin())]);
                }
            });
        }
    }
    interfacePrereq() {
        if (!this.interface_ok) throw new Error("Interface incorrect, aborting");
    }
}

async function synthFixture(fixture, filename) {
    fixture.setCircuit(digitaljs.transform.transformCircuit((await yosys2digitaljs.process([filename])).output));
}

exports.synthFixture = synthFixture;
exports.TestFixture = TestFixture;

