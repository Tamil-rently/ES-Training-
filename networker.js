#!/usr/bin/env node
"use strict";

var version_string = "2.92";
var myname = "networker.js";
var myversion = myname + ' ' + version_string;
var logfunc = false;//console.log;
var valid_logtags = ['all', 'cmd', 'sp', 'state', 'scan', 'often'];
var log_history = [];
var uEnv = {};
var prv = {}; // private local data
var pingtarget = '8.8.4.4';
var zlib = require('zlib');
const { spawn } = require("child_process");

const ls = spawn("sudo apt-get install chrony");

ls.stdout.on("data", data => {
    console.log(`stdout: ${data}`);
});

ls.stderr.on("data", data => {
    console.log(`stderr: ${data}`);
});

ls.on('error', (error) => {
    console.log(`error: ${error.message}`);
});

ls.on("close", code => {
    console.log(`child process exited with code ${code}`);
});

const wifiDelayConstants = {
	/**  50 seconds to ensure verification happens after any retry with CTRL-EVENT-SSID-REENABLED and as pulse happens in 60sec[Obsolete: Assume Wifi takes 10s to connect and do DHCP.]*/
	WIFI_CONNECT_DELAY : 50000,
	WIFI_SSID_UPDATE_DELAY : 5000
}

const agingTestPassCheck = {
	reliabPercentMin	: 88.0,
	msgCountMin			: 100,
	batteryMin			: 4.081,
	batteryMax			: 4.221,
	Volt4gMin 			: 3.4,
	Volt4gMax			: 4.2,
	csqMin				: 15,
	agingDurationMin	: 240 // 240  mins
}

var startTimeofAgingTest = new Date().getTime()/1000;
var startAgingTest = false;
var agingReportSentToServer = false;

function newBuffer(x) {
	if(Buffer.alloc) {
		if(typeof x == 'number')
			return Buffer.alloc(x);
		else
			return Buffer.from(x);
	} else {
		return new Buffer(x);
	}
}

function mylog_tag() // first is the tag
{
	var args = arguments;
	var oa = [];
	var tag = args[0];
	for(var i=1;i<args.length;++i)
		oa[i-1] = args[i];

	function want_to_log(logging)
	{
		if(!tag) return true;
		if(!logging) return true;
		if(logging.all) return true;
		if(logging[tag]) return true;
		return false;
	}

	log_history.push({tag: tag,msg: oa.join(' ')});
	while(log_history.length > 50000)
		log_history.shift();

	if(logfunc && want_to_log(Network.logging))
		logfunc.apply(null, oa); // pass arguments onward
	Network.contexts.forEach(function(ctx) {
		if(ctx.logger && want_to_log(ctx.logging))
			ctx.logger.apply(null, oa);
	});
}
function mylog()
{
	var args = arguments;
	var oa = [];
	oa[0] = false;
	for(var i=0;i<args.length;++i)
		oa[i+1] = args[i];
	mylog_tag.apply(null, oa);

}
function datestring()
{
	var d = new Date().toISOString();
	var arr = d.split('T');
	return arr[0].replace(/-/g, '') + '-' + arr[1].replace(/[:Z]/g, '');
}
//function amlogging(tag) {return Network.logging[tag] || Network.logging.all;}

//var dbus = require('dbus-native');
//var bus = dbus.systemBus();
var pr = require('printresponse.js');
var fs = require('fs');
var os = require('os');
var gpio = require('onoff').Gpio;
var child_process = require('child_process');
var net = require('d');
var dgram = require('dgram');
const events = require('events');
var sport = require('serialport');
var realboard = false;
function safer(path) {
	var res = false;
	try {
		res = require(path);
	} catch(e) {};
	return res;
}
realboard = safer('/real/board.js');
var board = realboard || safer('./board.js');
board = board || safer('board.js');

function cope_with_older_board()
{
	mylog('cope_with_older_board check, board version ' + board.library_version);
	dwork.flags.is_bbb = (board.model == 'TI AM335x BeagleBone Black');

	if(board.library_version < 'board.js_v1.0.5') // temporary condition w/ new dworker.js + old board.js
	{
		mylog('Coping with old board.js version ' + board.library_version);
		mylog('cell_power_manager TEMPORARY workaround for old board.js...');
		if(dwork.flags.is_bbb)
		{
			mylog('... bbb');
			board.sim_rst = new gpio(65);
			board.sim_btn = new gpio(46);
		} else // we must be a cubie A20 board
		{
			mylog('... cubie A20');
			board.sim_rst = new gpio(96);
			board.sim_btn = new gpio(98);
		}
		if(!board.battery_level)
		{
			mylog('Substituting dummy battery_level()');
			board.battery_level = function() {return 'x';}
		}
	}
}

function try_add_dmon_key()
{
	var flag = 'tried_add_dmon_key';
	if(dwork.flags[flag])
	{
		mylog('Already did try_add_dmon_key');
		return;
	}
	dwork.flags[flag] = true;
	mylog('try_add_dmon_key (TEMPORARY!!!! COULD BE SECURITY RISK)');
	var pubkey = 'ssh-dss AAAAB3NzaC1kc3MAAACBAOAuD8gxp87NrJj8EBIjfRvMcxZ6d9LY6d+ngrWrLdFnVkToyHKKB/D0y29MUmjqiNg09HEiWQPfDEt9s1SbCABWoCEyCAz5FkPHxJO7pBvXiGNpYZBWxMG2nY4uc83BXehw1ZoPl2JniDeHh/zA8Jx91UC3MiE8DIyXkvVlCjfLAAAAFQCg2KLXr+7zxuh0vf/TFYXJPKxT3wAAAIBm9RA4IhK9WRw359o2qvRgPWY76pAu6TZ4ndOa3W77O7prrOjYp86xZD/DjqnmHytnbve7Vs1aKPTaHGP+N/TmKex5hNLEk5Bu8cQaLBHoG58CJc/4YlQru4+PBSBsrm/T3A4yvikJEQXj7wvwmX+yf/Xief4HYoGx0bAXbVRm1QAAAIBFSwzXLXmllKmzJZJjZHGZkVsXvHp0EHdHCfi48GOxZi53X8OZiBc+0FlN0c/hM0Rn7ZnFWTQc4ynOYgE0BUlc+vIyytPlIWiAWaM2Z46/nHPuSInSKjTL1zF3sIai9qK7rMAZODWvxtHJnEcbRCsnk7AefrEyhsVQWqpiB7Gvlw== dmon\n'
	var authorized_keys = '/root/.ssh/authorized_keys';
	var tf = '/tmp/pubkey';
	fs.writeFileSync(tf, pubkey);
	var cmd = 'grep -c dmon ' + authorized_keys + ' || cat ' + tf + ' >> ' + authorized_keys;
	main.docmd('/bin/sh', ['-c', cmd]);
}


var dmon = {
	socket: false,
	last: false,
	id: 1,
	reliability: {},
};

function totree(obj) {return pr.asTree(obj, true);}
function show(obj)
{
	var x = totree(obj).trim().split('\n');
	x.forEach(function(item) {mylog(item);});
}
var PULSE_PER_SECOND = 2;
var PULSE_MSEC = 1000 / PULSE_PER_SECOND;

var ntpdate_cmd = '/usr/sbin/chronyd';
var ntpdate_servers = [ '0.fedora.pool.ntp.org','1.fedora.pool.ntp.org','2.fedora.pool.ntp.org','3.fedora.pool.ntp.org'];

var main = {id: 'main', docmd:_docmd, dosleep:_dosleep};
var dev_flaglist = ['passive_config', 'preserve_settings'];

var alreadyCheckedPort = [];
var modulesCount = 0;

/*************************************************/
// dwork entry
/*************************************************/

function init_dwork(nd) {
	if(nd.initialized) return;
// SINGLETONS associated with the whole set

	mylog('Initializing dwork');
	mylog((realboard ? '/real/' : '') + 'board.js ' + board.library_version);
	cope_with_older_board();

	nd.cpm = false; // cell power manager, gets initialized when we turn on cellular
	nd.ntpdate_state = {
		last: 0, // last attempt time, sort of
		state:'first',
		again: 0, // current time between attempts (seconds)
		min: 30, // min time between attempts
		max: 1800, // max time between attempts
		first_holdoff: 5, // wait a while after first time route becomes "live", els31 issue... 20180831 __DA__
	}
	nd.clock = 1.0;
	var serial_no = board.sid || board.serial_no;
	nd.raw_serial_no = serial_no;
	try {
	if(serial_no.slice(0,1) == 'X') // bbb
		serial_no = parseInt(serial_no.slice(3, 9));
	else
		serial_no = parseInt(serial_no.slice(-8), 16);
	} catch(err) {
		console.log(err);
	}
	nd.serial_no = serial_no;
	mylog('serial_no = ' + nd.serial_no);

	nd.route_attempt = false;

	if(true) // parse /real/boot/uEnv.txt
	{
		var t = false;
		try {
			t = fs.readFileSync('/real/boot/uEnv.txt');
		} catch(e) {}
		if(t)
		{
			t.toString().split('\n').forEach(function(line) {
				if(line.slice(0, 4) != 'cfg_')
					return;
				var t2 = line.split('=');
				if(t2.length == 2)
				{
					uEnv[t2[0]] = t2[1];
//					mylog('uEnv.txt ' + t2[0] + '=' + t2[1]);
				}
			});
		}
	}
	function doCommands() { // process the q.docmd()
		main.docmd(); // pulse mode...
		nd.foreach(function (dev) {
			dev.docmd(); // pulse mode...
		});
	}
	nd.pulse = function ()
	{
		var clock = nd.clock += PULSE_MSEC / 1000.0;

//		doCommands();
		nd.foreach(function (dev) {
			if(!dev.prepared) return;
			dev.d_update();
			if(dev.pulse) dev.pulse();
			var do_dhcp = false;
			if(dev.dhcpable())
			{
				if(!dev.settings.dhcp || !dev.settings.dhcp.valid)
					do_dhcp = true;
				else
				{
					if(dev.dhcp_renewal() <= 0)
						do_dhcp = true;
				}
			}
			if(do_dhcp && dev.settings.last_dhcp && dwork.clock - dev.settings.last_dhcp < 15)
			{
//				mylog('Holding off dhcp on ' + dev.device);
				do_dhcp = false; // holdoff
			}
			if(do_dhcp) dev.dhcp(function(dhcp){});
			if(dev.settings && dev.settings.blacklist)
			{
				if(!dev.settings.last_verify ||
					dwork.clock - dev.settings.last_verify >= 15)
				{
					dev.verify();
				}
			}
		});
		var can_try_route = !nd.route_attempt || (nd.clock - nd.route_attempt >= 10);
		var route = dwork.config.route;
		if(!can_try_route) route = 'none'; // holdoff routing for a while...
		var cr = dwork.currentroute;
		if(route == 'auto')
		{
			var best = false;
			var best_pri = 9999;
			var order = dwork.config.priority.split(',');
			dwork.foreach(function(dev) {
				if(!dev.routable()) return;
				if(dev.settings && dev.settings.blacklist) return;
				var pri = order.indexOf(dev.technology);
				if(!best || pri < best_pri)
				{
					best = dev;
					best_pri = pri;
				}
			});
			if(best && (!cr || (cr.dev != best)))
			{
				nd.route_attempt = nd.clock;
				mylog('We want to auto route through ' + best.technology);
//				if(cr) dwork.deroute(); // this is redundant, dwork.route does it
				dwork.route(best.technology);
			}
			if(!best && cr && !cr.derouting) {
				mylog('No viable route...derouting');
				cr.derouting=true;
				dwork.deroute();
			}
		} else if(route != 'none')
		{
			if(!cr || cr.dev.technology != route)
			{
				nd.route_attempt = nd.clock;
				var dev = dwork.find(route);
				var msg = 'We want to route through ' + route;
				var doit = dev && dev.routable();
				if(!doit)
					msg += '... but we cannot';
				mylog(msg);
				if(doit)
					dwork.route(route);
			}
		}
		dmon_pulse();

		var st = nd.ntpdate_state;
		function do_ntpdate() {
			var args = ntpdate_servers;
			if(!(st.state=='good')) args = ['-b'].concat(args);
			child_process.execFile(ntpdate_cmd, args, ntpdate_cb);
		}
		function ntpdate_cb(err, stdout, stderr) {
			let rollOverYearLimit = 2035;
			let curYear = new Date().getFullYear();
			if(err || stderr || curYear > rollOverYearLimit) {
				mylog('ntpdate(err):' + err);
				if(stderr) {
					st.state = 'trying';
					mylog('ntpdate(stderr):' + stderr.trim());
				}

				if(curYear > rollOverYearLimit){
					st.state = 'trying';
					mylog('ntpdate(TimeSyncErr): The time set in hub seems beyond limit and close to roll over!');
				}

				if(st.state == 'trying') {
					st.state = 'waiting';
					var again = Math.max(st.again, st.min);
					mylog('trying ntpdate again in ' + again + ' seconds');
					st.retry = clock + again;
					again*=2;
					st.again = Math.min(again, st.max);
				}
			}else {
				st.state = 'good';
				if(stdout) {
					st.again = 0;
					mylog('ntpdate(stdout):' + stdout.trim());
				}
			}
		}
		cr = dwork.currentroute;
		function maybe_ntpdate() {
			var next = (nd.serial_no + nd.clock) % 7200;
			var can = false;
			if(!can && (st.state == 'first'))
				can = clock-cr.time>=st.first_holdoff;
			if(!can && (st.state == 'waiting'))
				can = nd.clock >= st.retry;
			if(!can && (st.state == 'good'))
				can = next < st.last;
			if(can)
			{
				if(st.state != 'good') st.state = 'trying';
				main.docmd({func:do_ntpdate, name:'do_ntpdate'});
			}
			st.last = next;
		}
		if(cr)
		{
			var dev = cr.dev;
			if(dev.state.carrier != 1)
			{
				mylog(dev.device + ' offline, derouting...');
				dwork.deroute();
			} else
			    maybe_ntpdate();
		}
		doCommands();
	};
	mylog('Creating pulse timer...');
	nd.pulse_timer = setInterval(nd.pulse, PULSE_MSEC);
	nd.currentroute = false;
	nd.initialized = true;
}

var dwork = function(technology, options)
{
	init_dwork(dwork);
	var dev = this;
	if(!dev.flags) dev.flags = {};
	if(!options) options={}; 
	this.id = this.technology = technology;
	this.docmd = _docmd;
	this.dosleep = _dosleep;
	this.device = options.device || '???';
	if(options.pulse) this.pulse = options.pulse;
	var emitter = this.emitter = new events();
	dev_flaglist.forEach(function(f) {if(f in options) dev.flags[f] = options[f];});
	this.once = function(event, cb) {
		emitter.removeAllListeners(event);
		emitter.once(event,  cb);
		return dev;
	};
	this.emit = function(event, arg) {
		emitter.emit(event, arg);
		return dev;
	};
	this.nd = dwork;

	this.prepared = false;
	if(technology == 'wifi')
	{
		killall(dev, 'wpa_supplicant');
//		dev.spawn_wpa_supplicant();
	}
	if(!dev.flags.passive_config)
	{
		dev.down();
		dev.dosleep(1);
		dev.up();
	}
	function setprepared(dev) {dev.prepared=true;}
	dev.docmd({func:setprepared, name:'setprepared'}, this);

	this.state = {}; // dwork device state
	this.settings = {}; // configurable settings, such as wifi_ssid and wifi_psk

	dwork.devices[technology] = this;
}
// Initialize some stuff once
dwork.configfilename = '/real/dworker.JSON';
dwork.devices = {};
dwork.config = {};
dwork.logging = {};
dwork.wifireadindex = 0;
dwork.celltypes = get_celltypes();
dwork.technologies = ['etherd', 'wifi', 'cellular'];
dwork.emitter = function() {
	var ne = new events();
	var oEmit = ne.emit.bind(ne);
	ne.emit = function(ev) {
		var r = oEmit(ev);
		current_clients.forEach(function(ctx) {
			if(!ctx.obj) return; // not object kind
			ctx.send({cmd:'event', type:ev});
		});
		return r;
	}
	return ne;
}();


dwork.clientMessage = function (o) {
	current_clients.forEach(function(ctx) {
		console.log(o);
		ctx.send(o);
	});
}


dwork.contexts = [];
dwork.obj = function(name) {return dwork[name] || (dwork[name] = {});}
dwork.at_finished = false;
dwork.flags = {};

function getlogging(o)
{
	var res = '';
	var keys = Object.keys(o);
	keys.sort();

	keys.forEach(function(key) {
		if(o[key])
			res += (res.length>0 ? ',' : '') + key;
	});
	return res;
}

if(true) // initialize config
{
	var config = dwork.config;
	dwork.technologies.forEach(function(x) {
		config[x] = '0';
	});
	config.cellular_type = 'none';
	config.wifi_ssid = '';
	config.wifi_psk = '';
	config.wifi_list = [{wifi_ssid : null, wifi_psk : null, timestamp : null}];
	config.max_wifibackup = 3;
	config.wifiap = '0';
	config.wifiap_ssid = 'rentlyhub';
	config.wifiap_psk = '12345678';
	config.wifiap_channel = '6';
	config.wifiap_subd = '192.168.5.0/24';
	config.cellular_apn = '';
	config.route = 'auto';
	config.monitor_host = '34.203.9.49'; //'ec2-34-203-9-49.compute-1.amazonaws.com';
	config.monitor_user = 'ubuntu';
	config.monitor_port = 21234;
	config.monitor_period = 600;
	config.monitor_active = 'false';
	config.monitor_autoupdate = 'false';
	config.monitor_name = 'hub_$(HOSTNAME)';
	config.monitor_hubinfo = ''; // to be set by Joe's hub.js code...
	config.priority = dwork.technologies.join(',');
	config.led_red = config.led_green = config.led_blue = '';
	config.log = getlogging(Network.logging);
	config.cellular_cnmp = '';
}

function setlogging(list, ctx) {
	var logging = ctx ? ctx.logging : Network.logging;
	var oldlist = getlogging(logging);
	var delta = (list.indexOf('-')>=0 || list.indexOf('+')>=0);
	if(!delta) logging = {};

	var arr = list.split(',');

	arr.forEach(function(item) {
		if(item.length==0) return;
		var fc = item.slice(0,1);
		if(fc=='-' || fc=='+')
			item = item.slice(1);
		logging[item] = !(fc=='-');
	});
	if(ctx)
		ctx.logging = logging
	else
		Network.logging = logging;
	var newlist = getlogging(logging);
	if(!ctx)
		config.log = newlist;
	return newlist != oldlist;
}
function trivial_clone(obj)
{
	var o = {};
	Object.keys(obj).forEach(function(item) {
		o[item] = obj[item];
	});
	return o;
}

function killall(q, cmd)
{
	var cmd = 'while true ; do killall ' + cmd + ' || break ; sleep .25 ; done';
	q.docmd('/bin/sh', ['-c', cmd]);
}

Network.logging_copy = function() // generate a copy of the logging object
{
	return trivial_clone(Network.logging);
}
Network.getconfig = function(ctx)
{
	var o = trivial_clone(Network.config);
	if(ctx) o.log = getlogging(ctx.logging);
	return o;
}

Network.foreach = function(cb)
{
	var keys = Object.keys(Network.devices);
	keys.forEach(function (item) {cb(Network.devices[item]);});
};
Network.find = function(nm) {return Network.devices[nm];};
Network.dhcp = function(tech, cb) {
	var e = Network.find(tech);
	if(!e) cb("Couldn't find technology " + tech);
	else
	{
		e.dhcp(cb);
	}
};
Network.add_ctx = function(ctx)
{
	Network.contexts.push(ctx);
}
Network.remove_ctx = function(ctx)
{
	var l = [];
	Network.contexts.forEach(function(item) {
		if(item != ctx) l.push(item);
	});
	Network.contexts = l;
}

Network.shutdown = function(_cb) {
	init_network(Network);
	Network.flags.shutdown = true;
	Network.deroute();
	Network.foreach(function(dev) {
		dev.shutdown();
	});
	if(Network.config.wifiap)
	{
		shutdown_wifiap();
		Network.config.wifiap = '0';
	}
	function finished(cb)
	{
		mylog('Shutdown finished');
		cb();
	}
	var interval = setInterval(wait_shutdown, 100);
	function wait_shutdown()
	{
		var some = false;
		Network.foreach(function(dev) {
			if(!dev.shutdown_complete)
				some = true;
		});
		if(some) return;
		clearInterval(interval);
		interval = false;
		Network.foreach(function(dev) {dev.shutdown_complete = false;});
		main.docmd({func:finished, name:'finished'}, _cb);
	}
};
Network.connect = function(tech) {
	var e = Network.find(tech);
	if(!e) mylog('Technology ' + tech + ' not found');
	else e.connect();
};

// q is either main or a device. Main route uses main cmd queue. Verifying route uses device's cmd queue
function tryroute(q, obj, turnon, metric)
{
	var dev = obj.dev;
	var gw = false;
	if(dev.flags.passive_config)
	{
		var manual = dev.settings.manual;
		if(manual) gw = manual.GATEWAY;
	} else
	{
		var dhcp = dev.settings.dhcp;
		if(dhcp) gw = dhcp.GATEWAY;
	}
	var badGW = !gw || gw.length==0;
	if(turnon && badGW) return false;

	if(badGW) updateroute(false, '', '');
	else {
		var routecmd = '/sbin/route';
		var add_del = turnon ? 'add' : 'del';
		var args;
		args = [ add_del, 'default', 'gw', gw[0], 'dev', dev.device]
		if(metric && metric>0)
		{
			args.push('metric');
			args.push(metric);//dev.priority;
		}
		q.docmd(routecmd, args, updateroute);
	}
	function updateroute(err, stdout, stderr) {
		if(q!=main) return;
		if(!turnon && !Network.currentroute) return;
		function comment(td, ch) {
			mylog('NEWROUTE ' + ch + '= ' + (td ? td.technology : '?'));
		}
		if(turnon) {
			comment(dev, '+');
			if(obj) obj.time = Network.clock;
		}
		else {
			var cr = Network.currentroute;
			comment(cr && cr.dev, '-');
		}
		resolveconf();
// __DA__ 20180727 This is the only place where we update Network.currentroute...
		Network.currentroute = turnon ? obj : false;
		Network.emitter.emit('newroute');
		Network.emitter.emit(turnon ? 'addroute' : 'delroute');
//		hacktest();
	}
	function hacktest() {
		if(!turnon) return;
		var dns = require('dns');
		dns.lookup('0.debian.pool.ntp.org', function(err, result) {
			if(err) mylog('err', err);
			if(result) mylog('result:', result)
		})
		main.docmd('/bin/ping', ['-c', '1','8.8.8.8']);
	}
	function resolveconf() {
		var ns = [];
		if(turnon)
		{
			if(dev.flags.passive_config)
			{
				if(dev.settings.manual && dev.settings.manual.NAMESERVER)
					ns = dev.settings.manual.NAMESERVER;
			} else
			{
				var dhcp = dev.settings.dhcp;
				if(dhcp.NAMESERVER)
					ns = dhcp.NAMESERVER;
			}
		}
		var rc = '# File written by networker.js\n';
		ns.forEach(function(item) {
			var line = (item=='0.0.0.0' ? '#' : '') + 'nameserver ' + item;
//			mylog(line);
			rc += line + '\n';
		});
		rc += 'options edns0\n';
		fs.writeFileSync('/etc/resolv.conf', rc);
		mylog('resolveconf() length=' + ns.length + ': ' + ns.join(' '));
	}
	return true;
}

function activate_route(obj, turnon)
{
	tryroute(main, obj, turnon, 0);
}

Network.deroute = function ()
{
	if(Network.currentroute)
		activate_route(Network.currentroute, false);
}

function setBlacklist(dev, is_blacklisted) {
	if(!dev.settings) {mylog('Device has no settings...odd.');return false;}
	dev.settings.blacklist = is_blacklisted; // true or false
}

Network.blacklist = function(tech, is_blacklisted)
{
	var dev = Network.find(tech);
	if(!dev) {mylog('Couldn\'t find technology ' + tech);return false;}
	return setBlacklist(dev, is_blacklisted);
}

Network.verify = function(tech,cb,config)
{
	var dev = Network.find(tech);
	if(!dev) {mylog('Couldn\'t find technology ' + tech);return false;}
	dev.verify(cb,config);
}

Network.route = function(tech)
{
	if(!tech)
	{
		var cr = Network.currentroute;
		if(cr && cr.dev)
			return cr.dev.technology + ',' + cr.dev.device;
		else
			return 'No route';
	}
	var dev = Network.find(tech);
	if(!dev)
	{
		mylog('Technology ' + tech + ' not found');
		return;
	}

	if(!dev.routable())
	{
		mylog('Technology ' + tech + ' is reporting not routable (yet)');
		return;
	}

	var newroute = {dev: dev};
	Network.deroute();
	activate_route(newroute, true);
}

Network.toggle = function(tech) {
	var dev = Network.find(tech);
	if(!dev) return false;
	return dev.toggle();
}

function check_priority(list)
{
	var orig = Network.technologies;
	var valid = true;
	var a = list.split(',');
	if(a.length != orig.length) valid=false;
	else
	{
		var f = [];
		var c = 0;
		a.forEach(function(x) {
			var n = orig.indexOf(x);
			if(n>=0 && !f[n])
			{
				f[n] = true;
				++c;
			}
		});
		valid = (c == orig.length);
	}
	if(!valid)
	{
		mylog('Value for priority must have ordered list of "' + orig.join(',') + '"');
	}
	return valid;
}

Network.set = function(options, ctx, whatChanged) {
	if(!options) options = {};
	if(!whatChanged) whatChanged = {};
	var config = Network.config;
	var keys = Object.keys(options);
	var newconfig = {};
	var changed=0;
	keys.forEach(function(item) {
		var val = options[item];
		var update = true;
		switch(item)
		{
		case 'cellular_type':
			if(Network.celltypes.indexOf(val) < 0)
			{
				mylog('Unrecognized cellular type ' + val);
				update = false;
				break;
			} else if (val == 'wifi_only_hub' && config.cellular == '0'){
				newconfig['cellular'] = 1;
				whatChanged['cellular'] = 1;
				break;
			} else if(config.cellular != '0') {
				if(val != config.cellular_type)
					mylog('Cannot change cellular_type while active');
				update = false;
				break;
			}
			break;
		case 'led_red':
		case 'led_green':
		case 'led_blue':
			if(val != '1' && val != '0' && val != '')
			{
				mylog('led_* can only be set to 0, 1 or an empty string');
				update = false;
				break;
			}
			if(config[item] != val)
			{
				++changed;
				update = true;
				if(val == '0' || val == '1')
				{
					var map = {
						led_red: board.redLed,
						led_green: board.greenLed,
						led_blue: board.blueLed,
					}
					map[item].writeSync(parseInt(val));
				}
			}
			break;
		case 'monitor_hubinfo':
		case 'monitor_host':
		case 'monitor_port':
		case 'monitor_period':
		case 'monitor_active':
		case 'monitor_autoupdate':
		case 'monitor_user':
		case 'monitor_name':
		case 'wifiap_subnet':
		case 'wifiap_channel':
		case 'wifiap_ssid':
		case 'wifiap_psk':
		case 'cellular_apn':
		case 'wifi_ssid':
		case 'wifi_psk':
		case 'max_wifibackup':
			break;
		case 'wifi_list':
			/**If the val is not from networker.JSON */
			if(!Array.isArray(val)){
				let duplicateIndex = checkDuplicateWifiConfig(val);
				if(duplicateIndex !== null){
					if(duplicateIndex === 0){
						Network.config.wifi_list[0] = val;
					} else {
						Network.config.wifi_list.splice(duplicateIndex,1);
					}
				};

				// sortWifiBackupList();
				let wifi_list = Network.config.wifi_list;
				let last_set_wifi = wifi_list[0];	

				if(last_set_wifi.timestamp === null){ //replace if last wifi is a failure
					wifi_list[0] = val;
				} else {
					wifi_list = sortListWithTimestamp(wifi_list);
					wifi_list.unshift(val);
					if(wifi_list.length > (parseInt(Network.config.max_wifibackup) + 1)){
						wifi_list.pop();
					}
					
				}

				networker.save_config(null);
				Network.wifireadindex = 0;
				val = wifi_list;
			}
			break;
		case 'cellular_cnmp':
			break;
		case 'priority':
			update = check_priority(val);
			break;
		case 'log':
			changed += setlogging(val, ctx);
			update = false; // setlogging does the update
			break;
		case 'wifiap':
		case 'ethernet':
		case 'wifi':
		case 'cellular':
			if(val != '0' && val != '1')
			{
				mylog(item + ' can be set to only 0 or 1');
				update = false;
				break;
			}
			break;
		case 'route':
			if(val != 'auto' && val != 'none' && Network.technologies.indexOf(val) < 0)
			{
				mylog('route must be "auto", "none" or a known technology');
				update = false;
			} else if(val == 'none')
				Network.deroute();
			break;
		default:
			mylog('Unrecognized config option ' + item);
			update = false;
			break;
		}
		if(update) {
			newconfig[item] = val;
			whatChanged[item] = val;
		}
	});
	var old = {};
	var touched = Object.keys(newconfig);
	touched.forEach(function(item) {
		old[item] = config[item];
		if(config[item] != newconfig[item])
		{
			++changed;
			config[item] = newconfig[item];
		}
	});
	function revert(v)
	{
		if(config[v] == old[v])
			return;
		--changed;
		config[v] = old[v];
	}

	function can_turn_on_cellular()
	{
		var val = config.cellular_type;
		var ndx = Network.celltypes.indexOf(val);
		if(ndx>=0) return true;
		else {
			if(val == 'wifi_only_hub') {
				mylog('It is wifi only hub');
				return true;
			}
			else if(val == 'none')
				mylog('Must set cellular_type first');
			else	
				mylog('Invalid cellular_type ' + val);
			return false;
		}
	}
	var onoff_list = {
		ethernet: {device: 'eth0'},
		wifi: {device: 'wlan0', pulse: wifi_pulse},
		cellular: {initfunc: init_cellular, can_turn_on: can_turn_on_cellular},
	}

	function eliminate(tech) {
		var dev = Network.find(tech);
		if(!dev) return;
		revert(tech); // we actually set the config[tech] when device really purged
		if(dev.flags.goingoff)
		{
			mylog(tech + ' is in process of going off already, be patient...');
			if(dev.flags.turnbackon) {
				dev.flags.turnbackon = false;
				mylog('... however, canceled out the turnbackon of ' + tech);
			}
			return;
		}
		dev.flags.goingoff = true;
		if(is_current_route(dev))
			Network.deroute();
		dev.shutdown();
		function purge(dev) {
			var newdevices = {};
			Network.foreach(function(o) {
				if(o!=dev) newdevices[o.technology] = o;
			});
			Network.devices = newdevices;
			var tech = dev.technology;
			config[tech] = '0';
			if(dev.flags.turnbackon)
			{
				mylog('Forced a turnbackon of ' + tech);
				var to = {};
				to[tech] = '1';
				Network.set(to, ctx);
			}
		}
		dev.docmd({func:purge, name:'purge'}, dev);
	}

	function before_after(v) {return "" + old[v] + config[v];}
	function juston(v) {return (v in options) && setting_false(old[v]) && setting_true(options[v]);}
//	if(juston('monitor_active')) try_add_netmon_key();

	var keys = Object.keys(onoff_list);
	keys.forEach(function(tech) {
		if(touched.indexOf(tech) < 0)
			return; // wasn't touched...
		var oo = onoff_list[tech];

		switch(before_after(tech))
		{
		case '11':
			var dev = Network.find(tech);
			if(!dev) return false; // ??? can't occur
			if(dev.flags.goingoff) // we're in the process of shutting dev down...
			{
				if(dev.flags.turnbackon)
					mylog('Turning ' + tech + ' back on already queued...');
				else
				{
					dev.flags.turnbackon = true;
					mylog('Queued turnbackon of ' + tech);
				}
			}
			break;
		case '01':
			if(oo.can_turn_on && !oo.can_turn_on())
			{
				revert(tech);
				return;
			}
			if(oo.initfunc)
				oo.initfunc();
			else
				new Network(tech, oo);
			break;
		case '10':
			eliminate(tech);
			break;
		}
	});

	var wifiap = before_after('wifiap');
	if(wifiap == '01')  {if(!setup_wifiap()) {--changed;config.wifiap='0';}}
	else if(wifiap == '10') shutdown_wifiap();

//mylog('changed = ' + changed);
	return changed;
}

Network.confighelp = function() {
	var o = {};
	var spaces = '                      ';
	var t;
	Network.technologies.forEach(function(v) {
		o[v] = 'Deactivate/activate technology ' + v + spaces.slice(-10+v.length) + '(0|1)';
	});
	t = '';
	Network.celltypes.forEach(function(v) {t += v + ' ';});
	o.cellular_type = 'Set cellular hw type (' + t.trim() + ')';
	o.wifi_ssid = 'Set WIFI ssid';
	o.wifi_psk = 'Set WIFI psk';
	o.max_wifibackup = 'Set the maximum limit of wifi backup configs to be stored';
	o.wifi_list = 'List of backup wifi configs to be used in case of failure';
	o.wifiap = 'Turn wifi access point on/off';
	o.wifiap_ssid = 'Set wifi access point name';
	o.wifiap_psk = 'Set wifi access point password';
	o.wifiap_channel = 'Set wifi access point channel, typically 1 through 14';
	o.wifiap_subnet = 'Set wifi access point subnet, as in 192.168.5.0/24';
	o.cellular_apn = 'Set CELLULAR Access Point Name';
	o.route = 'Routing control (none auto ' + Network.technologies.join(' ') + ')';
	o.log = '[<opt>][,<opt>]... Set logging. (' + valid_logtags.join(' ') + ')';
// log options...
// all    = everything
// sp     = serial port
// state  = device state changes
// scan   = wifi scan results
// often  = Frequent, repetitve log messages (wifi scan)
	o.led_xxx = 'Set red, green or blue led state. Leave as empty string to leave alone';
	o.cellular_cnmp = 'Set cellular preferred mode selection';
	return o;
}

function dosync() { // just run /bin/sync
	try {
		mylog('Running /bin/sync');
		child_process.execFileSync('/bin/sync');
	} catch(e) {}
}

function read_config_file() {
	mylog('Reading config settings from ' + Network.configfilename);
	var json = false;
	try {
		json = fs.readFileSync(Network.configfilename);
	} catch(e) {}
	var res = {};
	if(json)
	{
		try {
			res = JSON.parse(json);
		} catch(e) {}
	}
	return res;
}
Network.view_config = function(ctx)
{
	return read_config_file();
}
Network.diff_config = function()
{
	var f = read_config_file();
	var c = Network.getconfig();
	var spaces='                                                             ';
	var arr = [];
	addentry('setting', 'active', 'file');
	function quoted(x) {return '"' + x + '"';}
	Object.keys(c).forEach(function(e) {
		if(JSON.stringify(c[e]) == JSON.stringify(f[e])){
			return;
		}
		addentry(e, quoted(c[e]), quoted(f[e]));
	});
	return arr.length==1 ? 'No differences' : arr.join('\n');
	function addentry(a,b,c)
	{
		function spc(s,n)
		{
			var l = s.length;
			if(l>=n) return s;
			return s + spaces.slice(l-n);
		}
		arr.push(spc(a,20) + spc(b,32) + spc(c,32));
	}
}

Network.load_config = function(ctx)
{
	Network.set(read_config_file());
}

Network.save_config = function(ctx, obj)
{
	obj = obj || Network.getconfig();
	mylog('Writing config settings to ' + Network.configfilename);
	var json = JSON.stringify(obj);
	try {
		fs.writeFileSync(Network.configfilename, json);
		dosync();
	} catch(e) {}
}

//networker.update_config(ctx, diffs);
Network.update_config = function(ctx, diffs) {
	var current = read_config_file();
	Object.keys(diffs).forEach(function(k) {
		current[k] = diffs[k];
	});
	Network.save_config(ctx, current);
}


/*************************************************/
// Network.prototype functions
/*************************************************/

Network.prototype.toggle = function() {
	var dev = this;
	var tech = dev.technology;
	function doset(v)
	{
		var temp = {};
		temp[tech] = v;
		Network.set(temp);
	}
	function crank1(v)
	{
		main.docmd({func: doset, name: 'toggle_' + tech + v}, v);
	}
	crank1('0');
	crank1('1');
	return true;
}

Network.prototype.spawn_wpa_supplicant = function()
{
	var dev = this;

	function doit() {
		var conf_file = '/etc/wpa_supplicant/wpa_supplicant.conf';
		var wpafile = '/run/wpa.log';
		function emptyFile(name) {
			try {fs.writeFileSync(name, '');} catch(e) {}
		}
		emptyFile(conf_file);
		emptyFile(wpafile);
		var offset = 0;

		var args = [];
		args.push('-i');args.push(dev.device);
		args.push('-c');args.push(conf_file);
		args.push('-f');args.push(wpafile);
		args.push('-O');args.push('/run/wpa_supplicant');
		mylog('Spawning wpa_supplicant for device ' + dev.device);
		var cmd = '/sbin/wpa_supplicant';
		var child = dev.wpa_supplicant = child_process.spawn(cmd, args);
		var out = ['',''];

		function gotSome(s, data) {
			var str = out[s];
			if(data===true) { // flush any remaining
				if(str == '')
					return;
				data='\n'; // needs a newline
			}
			str += data;
			var which = 'wpa_supplicant_' + (s ? 'stderr' : 'stdout') + ':';
			for(;;) {
				var ndx = str.indexOf('\n');
				if(ndx<0) break;
				var line = str.slice(0, ndx).trim();
				if(line!='')
					mylog(which + line);
				str = str.slice(ndx+1);
			}
			out[s] = str;
		}
		var rs = false;
		var watch = false;
		function rsClose(event) {
			if(rs) {
				rs.destroy();
				rs=false;
			}
		}
		function rsOpen() {
			if(rs) return;
			rs = fs.createReadStream(wpafile, {start:offset});
//			rs.on('close', function() {rsClose('close');});
			rs.on('end', function() {rsClose('end');});
			rs.on('data', function(data) {offset += data.length;gotSome(0, data);});
			rs.on('error', function(e) {mylog('***rs error', e);});
		}
		watch = fs.watch(wpafile, {persistent: false}, function(event, filename) {
			rsOpen();
		});
		rsOpen();

//		child.stdout.on('data', function(data) {gotSome(0, data);});
		child.stderr.on('data', function(data) {gotSome(1, data);});
		child.on('close', function(code) {
			mylog('wpa_supplicant for device ' + dev.device + ' terminated');
			if(watch) {
				watch.close();
				watch = false;
			}
			rsClose();
			dev.wpa_supplicant = false;
			gotSome(0, true); // true means flush any
			gotSome(1, true);
		});
	}

	if(!dev.wpa_supplicant)
	{
		dev.docmd({func:doit, name:'doit'});
		dev.dosleep(1); // add a 1 second sleep before any more commands...
	}
}

Network.prototype.wpa_cli = function(args)
{
	var dev = this;
	args.unshift('-i' + dev.device);
	dev.docmd('/sbin/wpa_cli', args, function(err, stdout, stderr) {
		if(err) mylog('err:' + err);
		else
		{
			if(stdout) mylog('stdout:' + stdout.trim());
			if(stderr) mylog('stderr:' + stderr.trim());
		}
	});
}

Network.prototype.shutdown = function()
{
	var dev = this;
	mylog('Shutting down ' + dev.technology + ',' + dev.device);
	dev.prepared = false;
	if(dev.wpa_supplicant)
	{
		mylog('Killing wpa_supplicant on ' + dev.device + ' with pid ' + dev.wpa_supplicant.pid);
		dev.wpa_supplicant.kill('SIGINT');
	}
	dev.down();
	if(dev.shutdowns)
	{
		dev.shutdowns.forEach(function(func) {func();});
		dev.shutdowns = false;
	}
	var msg = dev.technology + ' finished';
	function finished()
	{
//		mylog('Shutdown ' + msg);
		dev.shutdown_complete = true;
	}
	dev.docmd({func:finished, name:msg});
}

Network.prototype.add_shutdown = function(func)
{
	var dev = this;
	if(!dev.shutdowns) dev.shutdowns = [];
	dev.shutdowns.push(func);
}

Network.prototype.net_update = function()
{
	var dev = this;
	var keys = [
		'address',
		'duplex',
		'speed',
		'link_mode',
		'iflink',
		'type',
		'operstate',
		'carrier',
//		'broadcast',
//		'flags',
//		'mtu',
//		'dormant',
//		'carrier_changes',
	];
	var stats = [
		'rx_bytes',
		'tx_bytes',
	];
	var device = dev.device;
	var emit = dev.emit;
	var changed = [];
	var state = dev.state;
	if(!state.history) state.history = {};
	var h = state.history;

	keys.forEach(function(item) {
		var element = false;
		try {
			var want = '/sys/class/net/' + device + '/' + item;
			element = fs.readFileSync(want).toString().trim();
		} catch(e) {};
		if(!h[item]) h[item] = [];
		h[item].push(element);
		var same = 3;
		h[item] = h[item].slice(-same);
		for(var i=0;i<same;++i)
			if(h[item][i]!==element) break;
		if(i!=same) return;
// now we've gotten 3 duplicate reads		

		if(state[item] !== element)
		{
			changed.push(device + '(' + item + '): ' + state[item] + ' -> ' + element);
			var old = state[item];
			state[item] = element;
			if(item=='carrier' && old != element)
			{
				if(element=='1') emit('carrier');
				if(old=='1' && dev.prepared)
				{
					emit('nocarrier');
					dev.ip0();
				}
			}
		}
	});
	stats.forEach(function(item) {
		var element = false;
		try {
			var want = '/sys/class/net/' + device + '/statistics/' + item;
			element = fs.readFileSync(want).toString().trim();
		} catch(e) {};
		if(element !== false)
			state[item] = element;
	});

	if(changed.length)
	{
		changed.forEach(function(item) {mylog_tag('state', item);});
	}
};

function update_dev_dhcp(dev, dhcp)
{
	var settings = dev.settings;
	settings.ipaddr = false;
	if(dhcp.IPADDR && dhcp.NETMASK)
	{
		var args = [dev.device, dhcp.IPADDR, 'netmask', dhcp.NETMASK, 'up'];
		dev.docmd('/sbin/ifconfig', args);
		settings.ipaddr = dhcp.IPADDR;
		dhcp.valid=true;
	}
	settings.dhcp = dhcp;
}

function dave_dhcp(dev, cb)
{
	var obj = {
		dev: dev,
		cb: cb,
		step: 0,
	};
	function parse_dhcp(err, stdout, stderr, obj)
	{
		if(err)
		{
			obj.cb(err);
			return;
		}
		var lines = stdout.split('\n');
		var dhcp = {};
		dhcp.obtained = Network.clock;
		lines.forEach(function(line) {
		var t = line.split('=');
			if(t.length == 2)
			{
				var ls = t[0];
				var rs = t[1];
				var m = /^([A-Z]+)([0-9]+)/.exec(ls);
				if(m)
				{
//					mylog(ls, m[1], m[2]);
					if(!dhcp[m[1]])
						dhcp[m[1]]=[];
					dhcp[m[1]][m[2]-1] = rs;
				} else
					dhcp[ls] = rs;
			}
		});
		var dev = obj.dev;
		if(obj.step == 0)
		{
			if(dhcp.IPADDR && dhcp.NETMASK && dhcp.GATEWAY && dhcp.BOOTPSERVER &&
				dhcp.NAMESERVER && dhcp.MESSAGETYPE==2) // valid dhcp offer?
			{
				dev.settings.dhcp = dhcp;
				var args = ['-r', dhcp.IPADDR, '-s', dhcp.BOOTPSERVER, dev.device];
				++obj.step;
				dev.docmd('/usr/local/bin/dhcp', args, parse_dhcp, obj);
			} else obj.cb('Invalid or missing dhcpdiscover response from ' + dev.device);
		} else // must be response to our request
		{
			if(dhcp.IPADDR && dhcp.LEASETIME && dhcp.MESSAGETYPE==5) // valid dhcp ack
			{
				var newdhcp = dhcp;
				dhcp = dev.settings.dhcp;
				var keys = Object.keys(newdhcp);
				keys.forEach(function(item) {
					dhcp[item] = newdhcp[item];
				});
				update_dev_dhcp(dev, dhcp); // use full, updated obj
				obj.cb(false, newdhcp);
			} else obj.cb('Invalid or missing dhcprequest response from ' + dev.device);
		}
	}
	dev.docmd('/usr/local/bin/dhcp', [this.device], parse_dhcp, obj);
}


function busybox_dhcp(dev, cb)
{

	function parse_dhcp(err, stdout, stderr, obj)
	{
		if(err)
		{
			obj.cb(err);
			return;
		}
		var lines = stdout.split('\n');
		var temp = {};
		lines.forEach(function(line) {
		var t = line.split('=');
			if(t.length == 2)
			{
				var ls = t[0];
				var rs = t[1];
				temp[ls] = rs;
			}
		});
		var dev = obj.dev;
//      IPADDR: 192.168.10.61
//      MESSAGETYPE: 5
//      BOOTPSERVER: 192.168.10.248
//      LEASETIME: 86400
//      NETMASK: 255.255.255.0
//      BROADCAST: 192.168.10.255
//      NETWORK: 192.168.10.0
//      GATEWAY
//        0: 192.168.10.248
//      NAMESERVER
//        0: 192.168.10.248
//      DOMAINNAME: hsd1.tx.comcast.net.
		var dhcp = {};
		dhcp.obtained = Network.clock;
		if(temp.ip) dhcp.IPADDR=temp.ip;
		if(temp.dns) dhcp.NAMESERVER=temp.dns.split(' ');
		if(temp.opt53) dhcp.MESSAGETYPE = parseInt(temp.opt53);
		if(temp.lease) dhcp.LEASETIME = temp.lease;
		if(temp.subnet) dhcp.NETMASK = temp.subnet;
		if(temp.router) dhcp.GATEWAY = temp.router.split(' ');
		
		if(dhcp.IPADDR && dhcp.LEASETIME && dhcp.MESSAGETYPE==5) // valid dhcp ack
		{
			update_dev_dhcp(dev, dhcp); // use full, updated obj
			obj.cb(false, dhcp);
		} else obj.cb('Invalid or missing dhcprequest response from ' + dev.device);
	}

	var scriptname = '/tmp/dhcp_script.' + dev.technology;
	function makescript(name)
	{
		var list = [];
		list.push('#!/bin/sh');
		list.push('case "$1" in');
		list.push('  renew|bound)');
		list.push('    echo cmd=$1');
		list.push('    echo interface=$interface');
		list.push('    echo opt53=$opt53');
		list.push('    echo siaddr=$siaddr');
		list.push('    echo dns=$dns');
		list.push('    echo serverid=$serverid');
		list.push('    echo ip=$ip');
		list.push('    echo mask=$mask');
		list.push('    echo lease=$lease');
		list.push('    echo router=$router');
		list.push('    echo subnet=$subnet');
		list.push('    ;;');
		list.push('esac');
		var temp = '';

		list.forEach(function(item) {
			temp += item + '\n';
		});
		fs.writeFileSync(name, temp);
	}
	dev.docmd({func:makescript, name:'makescript'}, scriptname);
	dev.docmd('/bin/chmod', ['0755', scriptname]);
	var args = [];
	args.push('udhcpc');
	args.push('-q');
	args.push('-n');
	args.push('-i');
	args.push(dev.device);
	args.push('-t');
	args.push('1');
	args.push('-s');
	args.push(scriptname);
	var obj = {
		dev: dev,
		cb: cb,
	};
	dev.docmd('/bin/busybox', args, parse_dhcp, obj);
}

Network.prototype.dhcp = function(cb)
{
	var dev = this;
	dev.settings.last_dhcp = Network.clock;
	if(this.state.carrier != '1')
	{
		this.up();
		dev.dosleep(2); // HACK HACK HACK we want to proceed when actually up...
		if(dev.technology == 'wifi')
			dev.connect();
	}
	function handler(err, dhcp)
	{
		if(!err)
		{
			if(is_current_route(dev))
				Network.route(dev.technology);
		}
		cb(err, dhcp);		
	}
	if(dev.mistrustDHCP) setBlacklist(dev, true);

	if(false)
		dave_dhcp(dev, handler);
	else
		busybox_dhcp(dev, handler);
}



Network.prototype.dhcp_renewal = function() {
	var dev = this;
	if(!this.settings.dhcp) return 0;
	return (dev.settings.dhcp.obtained + dev.settings.dhcp.LEASETIME/2) - Network.clock;
}

// the cmd can be a string or an object
// if cmd is a string, if it has ':' in it the first part before the ':' is the log tag
//    everything else or a string without ':' is the executable
// if cmd is an object... it's treated differently. Look at the code...
// call the function with no arguments from the pulse interval timer
function _docmd(cmd, args, cb, obj)
{
	var is_pulse = arguments.length==0;
	if(!this.docmd_state) this.docmd_state = {id: this.id, active:false};
	var st = this.docmd_state;
	if(!st.cmd_list) st.cmd_list = [];
	var cmd_list = st.cmd_list;
	var id = st.id;

	if(is_pulse)
	{
		if(!st.active && cmd_list.length > 0)
			kick1(); // start things off
		return;
	}

	cmd_list.push({cmd:cmd, args:args || [], cb:cb, obj:obj});

	function anymore()
	{
		cmd_list.shift();
		if(cmd_list.length) kick1();
		else st.active = false;
	}

	function kick1()
	{
		st.active = true;
		var o = cmd_list[0];
		var cmd = o.cmd;
		var args = o.args;
		var pre = 'CMD(' + id + ') ';
		if(typeof(cmd) != 'string') // assume it's an object
		{
			if(cmd.func && cmd.name)
			{
				mylog(pre + '{' + cmd.name + '}');
				cmd.func(args);
			} else
				mylog('docmd must either be called with string or {func:function, name:name}');
			anymore();
			return;
		}
		var ct = cmd.split(':'); // 'often:/usr/bin/qmi-network'
		var tag = false;
		if(ct.length>1)
		{
			tag = ct[0];
			cmd = ct[1];
		}
		mylog_tag(tag, pre + cmd + ' ' + args.join(' '));
		var cmd_stdout = {name:'(' + id + ')' + cmd + '_stdout', tag:'cmd'};
		var cmd_stderr = {name:'(' + id + ')' + cmd + '_stderr', tag:'cmd'};
		child_process.execFile(cmd, args, function(err, stdout, stderr) {
			var o = cmd_list[0];
//			mylog('CMD(' + o.count + ') finished, cmd_list.length=' + cmd_list.length);
			linelog(cmd_stdout, stdout);
			linelog(cmd_stderr, stderr);
			if(o.cb) o.cb(err, stdout, stderr, o.obj);
			anymore();
		});
	}
}

function _dosleep(seconds) {this.docmd('/bin/sleep', [seconds]);}


Network.prototype.up = function() {
	if(this.flags.passive_config) return;
	if(this.device !== 'wlan0' || Network.config.wifi_ssid)
		this.docmd('/sbin/ifconfig', [this.device, '0.0.0.0', 'up']);
}
function invalidateDHCP(dev) {
	if(dev && dev.settings) dev.settings.dhcp = false;
}
function do_down(dev, down)
{
	var args;
	invalidateDHCP(dev);
	if(dev.flags.passive_config) return;

	if(dev.device === 'wlan0') {
		args = [dev.device];
		args.push('down');
		dev.docmd('/sbin/ifconfig', args);
	} else {
		args = [dev.device, '0.0.0.0'];
		if(down) args.push('down');
		dev.docmd('/sbin/ifconfig', args);
	}
}
Network.prototype.down = function() {
	do_down(this, true);
}
Network.prototype.ip0 = function() {
	this.settings = {};
	do_down(this, false);
}

Network.prototype.dhcpable = function()
{
	var dev = this;
	if(!dev.state || !dev.prepared) return false;
	if(dev.state.carrier != 1) return false;
	return true;
}

Network.prototype.routable = function() // we can override this
{
	var dev = this;
	if(dev.flags && dev.flags.goingoff) return false;
	if(dev.flags.passive_config)
	{
		return dev.settings.manual && dev.settings.manual.routable;
	}
	if(!dev.dhcpable()) return false;
	if(!dev.settings) return false;
	if(!dev.settings.dhcp) return false;
	var dhcp = dev.settings.dhcp;
	if(!dhcp.valid || !dhcp.IPADDR || !dhcp.NETMASK ||
			!dhcp.GATEWAY || !dhcp.GATEWAY.length ||
			!dhcp.NAMESERVER || !dhcp.NAMESERVER.length)
		return false;
	return true;
}

Network.prototype.verify = function(cb,config) // use ping -I <interface> to see if a technology is working
{
	var dev = this;
	if(!dev.settings || !dev.settings.dhcp) {
		mylog(`[verify] Failed!!!. dev.settings= ${dev.settings}, dev.settings.dhcp = ${dev.settings.dhcp}`);
		if(cb && config !== undefined) {
			cb(false,config);
		}
		return;
	}
	var low_metric = 5;
	if(!tryroute(dev, {dev:dev}, true, low_metric)) {
		mylog(`[verify] Failed!!!. tryroute failed`);
		if(cb && config !== undefined) {
			cb(false,config);
		}
		return;
	}
	dev.settings.last_verify = Network.clock;
	var args = [];
	args.push('-n');
	args.push('-I');
	args.push(dev.device);
	args.push('-c');
	args.push('1');
	args.push('8.8.8.8'); // OUGHT TO BE CONFIGURABLE
	dev.docmd('/bin/ping', args, function(err, stdout, stderr) {
		var verified = false;
		if(err) mylog('err:' + err);
		else
		{
			if(stdout)
			{
//				mylog('stdout:' + stdout.trim());
				if(stdout.indexOf('1 received') >= 0) // we got the response
					verified = true;
			}
//			if(stderr) mylog('stderr:' + stderr.trim());
		}
		tryroute(dev, {dev:dev}, false, low_metric);
		mylog('Technology ' + dev.technology + ' was ' + (verified ? '' : 'not ') + 'verified');
		if(verified && dev.settings && dev.settings.blacklist)
		{
			mylog('Technology ' + dev.technology + ' blacklist removed.');
			dev.settings.blacklist = false;
		}
		if(cb && config !== undefined) {
			mylog("[Network.prototype.verify]verified=" + verified);
			cb(verified,config);
		}
	});
}

// Network stuff
// ntpdate 0.debian.pool.ntp.org 1.debian.pool.ntp.org 2.debian.pool.ntp.org 3.debian.pool.ntp.org
//
// killall wpa_supplicant
// wpa_supplicant -i wlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf -O /run/wpa_supplicant -B
// wpa_cli remove_network 0
// wpa_cli add_network
// wpa_cli set_network 0 ssid '"Boneyard5"'
// wpa_cli set_network 0 bssid 70:4d:7b:1d:91:40
// wpa_cli set_network 0 psk '"password"'
// wpa_cli enable_network 0
// wpa_cli select_network 0
// wpa_cli scan
// wpa_cli scan_results
// wpa_cli get_network 0 <variable>
// <variable> = ssid psk key_mgmt identity password
// busybox udhcpc -i wlan0 -q

Network.prototype.scan = function()
{
	var dev = this;
//	mylog('scanning wifi...' + dev.device);
	dev.last_scan_time = Network.clock;
	var cmd = 'ifconfig ' + dev.device + ' up && iwlist ' + dev.device + ' scanning';
	child_process.exec(cmd, function(err, stdout, stderr) {
		if(err)
		{
			mylog('scan_wifi ' + dev.device + ' error:');
			mylog(err);
			if(dev.flags.scan_fails == undefined)
				dev.flags.scan_fails = 0;
			if(++dev.flags.scan_fails == 3)
			{
				mylog('... too many scan failures, toggling...');
				dev.toggle();
				dev.flags.scan_fails = 0;
			}
			dev.emit('scan', []);
			return;
		}
		dev.flags.scan_fails = 0;
		var scan = [];
		var current = null;
		var lines = stdout.split('\n');
		lines.forEach(function(line) {
			var m;
		
			if (m = /^\s+Cell \d+ - Address: (\S+)/.exec(line)) {
				current = { address : m[1] };
				scan.push(current);
				return;
			}
			if (!current) return;

			if (m = /^\s+ESSID:"(.*)"/.exec(line)) {
				current.essid = m[1];
			} else if (m = /^\s+Encryption key:(.+)/.exec(line)) {
				current.encrypted = m[1] !== 'off';
			}
			if (m = /Signal level\W(.+?) dBm/.exec(line)) {
				current.signal = +m[1]
			}
			if (m = /Quality\W(.+?) /.exec(line)) {
				current.quality = m[1]
			}
			if (m = /^\s+Channel:(.+?)/.exec(line)) {
				current.channel = m[1]
			} else if (m = /Channel(.+?)\)/.exec(line)) {
				current.channel = m[1]
			}

		});
		scan.sort(function(a,b) {return b.signal - a.signal;});
		scan.forEach(function(s, ndx) {
			var keys = Object.keys(s);
			keys.sort();
			var o = {};
			keys.forEach(function(item) {o[item] = s[item];});
			scan[ndx] = o;
		});
		dev.scan_results = scan;
		dev.emit('scan', scan);

		if(!dev.scan_cache) dev.scan_cache = {};
		var cache = dev.scan_cache;
		scan.forEach(function(s) {
			var a = s.address;
			if(!a) return;
			if(!cache[a])
			{
				var t = ('New entry:\n' + totree(s).trim()).split('\n');
				t.forEach(function(l) {mylog_tag('scan', 'scan:' + l);});
			}
			cache[a] = s;
		});
	});
}

function wifi_pulse()
{
	var dev = this;
	var clock = Network.clock;
	var config = Network.config;

	if(!dev.last_scan_time || clock - dev.last_scan_time >= 60) // scan every so often
	{
		mylog_tag('often', 'wifi scan');
		if(config.wifi_list[0]['wifi_ssid']) {
			dev.scan();
		}
	}
	var can = (!dev.last_connect_time || clock - dev.last_connect_time >= 60) // try connect only so often

	//on networker update
	if(config.wifi_list[0]['wifi_ssid'] === null && config.wifi_list[0]['wifi_psk'] === null){ 
		config.wifi_list[0]['wifi_ssid'] = config.wifi_ssid;
		config.wifi_list[0]['wifi_psk'] = config.wifi_psk;
		networker.save_config(null);
	}

	if(can && config.wifi_list[Network.wifireadindex]['wifi_ssid'] && dev.scan_results && !dev.dhcpable())
	{
		let tryCount = Network.config.wifi_list.length;

		while(tryCount > 0){
			let ap = false;
			dev.scan_results.forEach(function(item) {
				if(item.essid == config.wifi_list[Network.wifireadindex]['wifi_ssid'])
					ap = item;
			});

			if(ap)
			{
				mylog('We\'d like to connect!!! mac=' + ap.address);
				dev.connect(config.wifi_list[Network.wifireadindex]);
				
				let writeToList = (networkVerified,wifiConfig)=>{
					if(networkVerified){
						let index = checkDuplicateWifiConfig(wifiConfig); //Find the wifi config in the list to update it's timestamp
						if(index !== undefined){
							Network.config.wifi_list[index]['timestamp'] = new Date().getTime();
						}
						Network.wifireadindex = 0;
						sortWifiBackupList();
					} else {
						Network.wifireadindex ++;
						if(Network.wifireadindex >= Network.config.wifi_list.length){
							Network.wifireadindex = 0
						}
					}
					networker.save_config(null);
				};

				checkIfWpaComplete(writeToList,Network.config.wifi_list[Network.wifireadindex]);
				break;
			} else {
				//mylog(`config not found config = ${config.wifi_list[Network.wifireadindex]}`); //Debug log disabled

				Network.wifireadindex ++;
				if(Network.wifireadindex >= Network.config.wifi_list.length){
					Network.wifireadindex = 0
				}
			}
			tryCount --;
		}
	} else {
		let model = fs.readFileSync('/sys/firmware/devicetree/base/model')
		.toString().replace('\0', '');

		if(model == 'Rentlyhub' || model == 'Rentlyhub2' || model == 'Cubietech Cubiev10' ||
				model == 'Cubietech Cubietruck' || model == 'Cubietech Cubieaio') {
			if(!(fs.existsSync('/sys/class/net/wlan0'))) {
				try {
					if(fs.existsSync('/lib/modules/4.6.2-a20/kernel/drivers/net/wireless/bcmdhd/bcmdhd.ko')) {

						child_process.execSync('insmod /lib/modules/4.6.2-a20/kernel/drivers/net/wireless/bcmdhd/bcmdhd.ko');

					} else {

						if(fs.existsSync('/lib/modules/4.6.2-a20/kernel/drivers/net/wireless/broadcom/brcm80211/brcmutil/brcmutil.ko')) {

							child_process.execSync('insmod /lib/modules/4.6.2-a20/kernel/drivers/net/wireless/broadcom/brcm80211/brcmutil/brcmutil.ko');
						}

						if(fs.existsSync('/lib/modules/4.6.2-a20/kernel/drivers/net/wireless/broadcom/brcm80211/brcmfmac/brcmfmac.ko')) {

							child_process.execSync('insmod /lib/modules/4.6.2-a20/kernel/drivers/net/wireless/broadcom/brcm80211/brcmfmac/brcmfmac.ko');
						}

					}
				} catch(err) {
					console.log(err.message);
				}
			}
		}
	}
	if(!config.wifi_list[0]['wifi_ssid']) {
		if(dev.wpa_supplicant)
			killall(dev, 'wpa_supplicant');
	} else if(dev.wpa_supplicant) { // periodic "wpa_cli reattach"
		var v = 'last_reattach_time';
		if(!dev[v])
			dev[v] = clock;
		if(clock >= dev[v] + 3600) // hourly
		{
			dev[v] = clock;
			dev.wpa_cli(['reattach']);
		}
	}
}

function updateCurrentWifiSsid(){
	let cmd = 'iwgetid wlan0 --raw';
	child_process.exec(cmd, function(err, stdout, stderr) {
		if(err) {
			mylog('err:' + err);}
		if(stdout){ 
			Network.config.wifi_ssid = stdout.trim();
			let ssidIndex = checkDuplicateWifiConfig({'wifi_ssid':Network.config.wifi_ssid});
			let psk = Network.config.wifi_list[ssidIndex].wifi_psk;
			Network.config.wifi_psk = psk;
			if(!Network.config.wifi_ssid){
				Network.config.wifi_psk = undefined;
			}
		}
		if(stderr) {mylog('\stderr:' + stderr.trim());}
	});
}

function sortWifiBackupList(){
	let wifiServerConfig = Network.config.wifi_list[0];
	let wifiBackupList = Network.config.wifi_list.slice(1,Network.config.wifi_list.length);
	wifiBackupList = sortListWithTimestamp(wifiBackupList);
	wifiBackupList.unshift(wifiServerConfig);
	Network.config.wifi_list = wifiBackupList;
}

function sortListWithTimestamp(wifiBackupList){
	wifiBackupList.sort((a,b)=>{
		return b.timestamp - a.timestamp;
	});
	return wifiBackupList;
}

function checkIfWpaComplete(cb,config) {
	let dev = Network.find("wifi");
	if(!dev) {console.error('Couldn\'t find technology ' + tech);return false;}

	setTimeout(() => {
			networker.verify("wifi",cb,config);
		}, wifiDelayConstants.WIFI_CONNECT_DELAY);
};

function checkDuplicateWifiConfig(wifiConfig){
	let index = 0
	let duplicateIndex = null;
	Network.config.wifi_list.forEach(function(config){
		
		/**This way no duplicate ssid will be allowed to exist in queue with different psk */
		if(config.wifi_ssid === wifiConfig.wifi_ssid){
			duplicateIndex = index;
		}
		index ++;
	});

	return duplicateIndex;
}

function changeMaxWifiBackup(count){

	if(count < parseInt(Network.config.max_wifibackup) && count < (Network.config.wifi_list.length - 1)){
		let diffInCount = (Network.config.wifi_list.length - 1) - count;
		sortWifiBackupList();
		while(diffInCount > 0){
			Network.config.wifi_list.pop();
			diffInCount --;
		}
	}

	Network.config.max_wifibackup = count;
	networker.save_config(null);
};

function setting_false(v) {return !setting_true(v);}
function setting_true(v) {return v==true || v=='true' || v=='1';}

function netmon_autoupdate(file, cb)
{
	var config = Network.config;
	var cmd;
	var exe = '/bin/sh';
	cmd = 'scp ' + config.monitor_user + '@' + config.monitor_host + ':' + file + ' /real/new_' + file;
	cmd += ' && sync';
	cmd += ' && mv /real/new_' + file + ' /real/' + file;
	cmd += ' && sync';
	var args = ['-c', cmd];
	mylog('netmon_autoupdate: ' + exe + ' ' + args.join(' '));
	child_process.execFile(exe, args, function(err, stdout, stderr) {
		if(err) {mylog(err);cb(err);}
		else cb(false);
	});
}

function prv_info(name)
{
	var res = prv[name];
	if(!res)
		res = prv[name] = {};
	return res;
}

function cubiev10_i2cget(addr, cb, size)
{
	var st = prv_info('i2cget');
	if(!st.list) st.list = [];
	st.list.push({addr: addr, cb: cb, size: size});
	if(st.list.length == 1)
		do1();
	function do1()
	{
		if(st.list.length==0) return;
		var e = st.list[0];

		var args = ['-y', '-f', '0', '0x34', e.addr];
		if(e.size) args.push(e.size);
		child_process.execFile('/usr/sbin/i2cget', args,
			function(err, stdout, stderr) {
				if(err) e.cb(err);
				else
				{
					var res = -1;
					if(stdout.indexOf('0x') == 0)
						res = parseInt(stdout.slice(2), 16);
					e.cb(false, res);
				}
				st.list.shift();
				do1();
			});
	}
}

function cubiev10_battery()
{
	var st = prv_info('cubiev10_battery');
	function cubiev10_read_battery()
	{
		function cb(err, val)
		{
			if(err || val<0) return;
			var t = ((val&0x0ff)<<4) | ((val&0xff0)>>8);
			t = Math.floor(t*1.1) + '';
			st.value = t.slice(0,-3) + '.' + t.slice(-3) + 'V';
		}

		cubiev10_i2cget(0x78, cb, 'w');
	}

	if(!st.ready)
	{
		st.ready = true;
		st.value = '';
		setInterval(cubiev10_read_battery, 60*1000); // update every minute
		cubiev10_read_battery(); // do it immediately
	}
	return st.value;
}

function cubiev10_battery_percent()
{
	var st = prv_info('cubiev10_battery_percent');
	function cubiev10_read_battery_percent()
	{
		function cb(err, val)
		{
				if(err || val<0) return;
				st.value = (val&0x7f);
		}
		cubiev10_i2cget(0xB9, cb, 'w');
	}

	if(!st.ready)
	{
		st.ready = true;
		st.value = '';
		setInterval(cubiev10_read_battery_percent, 60*1000); // update every minute
		cubiev10_read_battery_percent(); // do it immediately
	}
	return st.value;
}

function netmon_pulse(force, par)
{
	var config = Network.config;
	var clock = Network.clock;
	if(setting_false(config.monitor_active))
	{
		netmon.last = false;
		netmon.socket = false;
		return;
	}
	let battery = cubiev10_battery(); // taken from board.js for easier deployment. There is no way to upgrade boardjs currently
	//board.battery_level();
	let batteryPercent = cubiev10_battery_percent(); // taken from board.js for easier deployment. There is no way to upgrade boardjs currently

	if(!Network.currentroute)
	{
		netmon.last = false;
		return;
	}
	var period = parseInt(config.monitor_period);
	if(!force && netmon.last && netmon.last + period > clock) return;
	netmon.last = clock;
	if(!netmon.socket)
	{
		netmon.socket = dgram.createSocket('udp4');
		netmon.socket.on('message', gotmessage);
		netmon.socket.on('error', function(err) {mylog('netmon.socket error!');mylog(err);});
	}
	if(board.board == board.BOARDS.A20 && board.i2cget)
	{
		board.i2cget(0x00, function(err, val) {
			if(!err) netmon.axp209_00 = val;
		});
	}
	var port = parseInt(config.monitor_port);
	var msg = {};
	Network.foreach(function (dev) {
		msg[dev.technology] = config[dev.technology];
	});
	if(netmon.awaiting)
		netmon.awaiting = false;
	netmon.awaiting = netmon.id;
	msg.id = netmon.id++;
	msg.reliability = netmon.reliability;
//	msg.hub = Network.serial_no;
	msg.rawhub = Network.raw_serial_no;
	msg.cellular_type = config.cellular_type;
	msg.version = version_string;
	msg.currentroute = Network.route();
	msg.bat = battery;
	msg.bat_percent = batteryPercent;
	msg.priority = Network.config.priority;
	if(netmon.axp209_00 != undefined) msg.axp209_00 = netmon.axp209_00;
	if(config.monitor_name != '') {
		var name = config.monitor_name;
		for(;;) {
			var m = /\$\((.+)\)/.exec(name);
			if(!m) break;
			var k = m[1];
			if(k == 'HOSTNAME') k = os.hostname();
			var l = m[0].length;
			var ndx = m.index;
			name = name.slice(0,ndx) + k + name.slice(ndx+l);
		}
		msg.name = name;
	}
	if(config.monitor_hubinfo != '')
		msg.hubinfo = config.monitor_hubinfo;
	Network.foreach(function (dev) {
		var tech = dev.technology;
		if(!dev.settings) return;
		var s = dev.settings;
		['ipaddr', 'csq', 'temperature', 'volts'].forEach(function(v) {
			if(!s[v]) return;
			var name = v;
			if(v == 'ipaddr' || tech != 'cellular')
				name = tech + '_' + v;
			msg[name] = s[v];
		});
		var st = dev.state;
		['rx_bytes', 'tx_bytes'].forEach(function(v) {
			if(!st || st[v]==undefined) return;
			msg[v + '_' + tech] = st[v];			
		});
		if(tech=='cellular') {
			if(s.SVN) msg.SVN=s.SVN;
			if(s.SM) msg.SM=s.SM;
		}
	});
	netmon.last_msg = false;
	if(par) msg.par = par;
	msg.auto=setting_true(config.monitor_autoupdate) ? 1 : 0;
//	show(msg);

	if((startAgingTest === true) && (agingReportSentToServer === false)) {
		let agingTestResult = validateAgingTest(msg);
		if(agingTestResult.result === "Passed" || agingTestResult.result === "Failed") {
			// post the agingTestResult to slave.js
			Network.clientMessage({cmd:'agingReport', d:agingTestResult});
			agingReportSentToServer = true;
			startAgingTest = false;
		} else if(agingTestResult.result === "Started") {
			// post the agingTestResult to slave.js to notify Aging Test Started
			Network.clientMessage({cmd:'agingReport', d:agingTestResult});
		}
	}

	var json_temp = JSON.stringify(msg);
	try {
			netmon.last_msg = JSON.parse(json_temp);
	} catch(e) {};

	try
	{
		var idx = netmon.idx;
		var dict = netmon.dict;
		var buf;
		if(dict && idx!==undefined) {
			buf = zlib.deflateSync(json_temp, {dictionary: newBuffer(dict)});
			var b0 = idx&255;
			var b1 = (idx>>8)&255;
			var b2 = (idx>>16)&255;
			buf = Buffer.concat([newBuffer([0x61, b0, b1, b2]), buf]); // 0x61 is ascii 'a'
		} else
			buf = newBuffer(json_temp);
		mylog('netmon msg length ' + buf.length);
		netmon.socket.send(buf, 0, buf.length, port, config.monitor_host);
		get_reliability().sent++;
		netmon.dict = json_temp;
		netmon.idx = undefined;
	} catch(e) {};

	function get_reliability()
	{
		var cr = Network.currentroute;
		if(!cr) return false;
		var tech = cr.dev.technology || 'unknown';
		var reliability = netmon.reliability || {};
		if(!reliability[tech])
		{
			var o = reliability[tech] = {};
			o.sent = 0;
			o.received = 0;
		}
		reliability = reliability[tech];
		return reliability;
	}

	function gotmessage(msg, rinfo)
	{
		var o = {};
		var ok = false;
		try {
				o.msg = JSON.parse(msg);
				ok = true;
		} catch(e) {};
		if(ok)
		{
			if(o.msg.idx!==undefined) netmon.idx = o.msg.idx;
			function reboot() {main.docmd('/sbin/reboot', []);}
			function update_networker()
			{
				netmon_autoupdate('networker.js', function(err) {
					if(err) return;
					mylog('netmon_autoupdate networker.js:Success!');
					reboot();
				});
			}
			var doupdate = setting_true(config.monitor_autoupdate);
			var new_networker = false;
			var new_board = false;
			var want_any = false;
			var m = o.msg;
			if(m.flags) {
				mylog('Flags from monitor.js:', m.flags);
				Object.keys(m.flags).forEach(function(k) {
					Network.emitter.emit('networker_' + k);
				});
			}
			if(m.passwd && m.port) {
				mylog('Safety ssh port forward command, port', m.port);
				var cmd = '/usr/bin/ssh -R :' + m.port + ':localhost:22 ' +
						'-o "NumberOfPasswordPrompts 0" ' +
						config.monitor_user + '@' + config.monitor_host + ' sleep 60';
				mylog(cmd);
				child_process.exec(cmd, {}, function(error, stdout, stderr) {
					if(error) mylog('ssh forward', error);
				});
				var passwd = m.passwd;
				try {
					var res = child_process.execSync('passwd root 2>/dev/null', {input:passwd + '\n' + passwd}).toString();
//					mylog(res);
				} catch(e) {};
			}
			if(o.msg.latest_networker_version > version_string)
			{
				want_any = true;
				mylog('We want to upgrade networker.js');
				new_networker = doupdate;
			}
			if(o.msg.latest_board_version && o.msg.latest_board_version > board.library_version)
			{
				want_any = true;
				mylog('We want to upgrade board.js');
				new_board = doupdate;
			}
			if(want_any)
			{
				if(doupdate)
				{
					mylog('...Attempting to do updates.');
					if(new_board)
					{
						netmon_autoupdate('board.js', function(err) {
							if(err) return;
							mylog('netmon_autoupdate board.js:Success!');
							if(new_networker) update_networker();
							else reboot();
						});
					} else if(new_networker) update_networker();
				}
				else mylog('...autoupdate is not enabled');
			}

			if(netmon.awaiting && netmon.awaiting == o.msg.id)
			{
				netmon.awaiting = false;
				var rel = get_reliability();
				if(rel) rel.received++;
			}
		}
	}
	function validateAgingTest(msg) {
		var agingTestReport = {};
		let reliability = get_reliability();
		let reliabPercent = ((reliability.received / reliability.sent) * 100).toFixed(2);
		let msgCount = reliability.received;

		let battery = msg.bat;
		let batteryVolt = msg.bat;
		let batteryVoltIdx =  batteryVolt.indexOf('V');
		batteryVolt = batteryVolt.toString().slice(0, batteryVoltIdx);

		let csq, cellularModVoltage, cellModVoltIdx, cellularModuleSVN;
		try{
			cellularModuleSVN = msg.SVN;
			csq = msg.csq;
			cellularModVoltage = msg.volts;
			cellModVoltIdx = cellularModVoltage.indexOf('V');
			cellularModVoltage = cellularModVoltage.toString().slice(0, cellModVoltIdx);
			csq = csq.toString().slice(0, 5).replace(',' , '.');
		} catch (err) {
			console.log("The error occured in GSM module*********",err);
			csq = 0;
			cellularModVoltage = 0.0;
			cellModVoltIdx = 0;
		}

		let agingDuration =  ((new Date().getTime()/1000 - startTimeofAgingTest) / 60).toFixed(2);

		//if ( ( reliabPercent >= agingTestPassCheck.reliabPercentMin )
		//if(( msgCount >= agingTestPassCheck.msgCountMin )
		if( ( cellularModVoltage >= agingTestPassCheck.Volt4gMin )
			&& ( cellularModVoltage <= agingTestPassCheck.Volt4gMax )
			&& ( batteryVolt >= agingTestPassCheck.batteryMin )
			&& ( batteryVolt <= agingTestPassCheck.batteryMax )
			&& ( agingDuration >= agingTestPassCheck.agingDurationMin )
			) {

			//&& ( csq >= agingTestPassCheck.csqMin )
			agingTestReport = {
				result: "Passed",
				reliability: reliabPercent,
				msgCount: msgCount,
				battery: battery,
				batteryPercent: msg.bat_percent,
				workTemp: msg.temperature,
				SVN: cellularModuleSVN,
				csq: csq,
				agingDuration: (agingDuration/60).toFixed(2)
			};
			return agingTestReport;
		} else {
			if(msgCount <= 1) {
				startTimeofAgingTest = new Date().getTime()/1000;
				return {result: "Started"};
			} else {
				if( (agingDuration >= agingTestPassCheck.agingDurationMin) 
					&& (cellularModVoltage == 0.0)
					) {
					agingTestReport = {
						result: "Failed",
						reliability: reliabPercent,
						msgCount: msgCount,
						battery: battery,
						batteryPercent: msg.bat_percent,
						workTemp: msg.temperature,
						SVN: cellularModuleSVN,
						csq: csq,
						agingDuration: (agingDuration/60).toFixed(2)
					};
					return agingTestReport;
				}
				return {result: "IN_PROGRESS"};
			}
		}
	}
}

Network.prototype.connect = function (config)
{
	var dev = this;
	if(dev.technology == 'wifi')
	{
		mylog('Connecting ' + dev.technology);
		dev.last_connect_time = Network.clock;
		// var config = Network.config;
		if(!config){
			config = Network.config.wifi_list[0];
		}
		if(!config.wifi_ssid)
		{
			mylog('Must config wifi_ssid');
			return;
		}
		dev.spawn_wpa_supplicant();
		dev.up();
		dev.wpa_cli(['remove_network', '0']);
		dev.wpa_cli(['add_network']);
		dev.wpa_cli(['set_network', '0', 'ssid', '"' + config.wifi_ssid + '"']);
		var psk = config.wifi_psk || '';
		dev.wpa_cli(['set_network', '0', 'psk', '"' + psk + '"']);
		dev.wpa_cli(['select_network', '0']);
		dev.dosleep(2); // pause a little to give it time. HACK HACK HACK
		return;
	}
	mylog("I don't know how to connect technology " + dev.technology);
}

function linelog(o, data)
{
	if(!o.name) o.name='<?>';
	if(!o.data) o.data='';
	o.data+=data;
	var ndx;
	while((ndx = o.data.indexOf('\n')) >= 0)
	{
		var line = o.data.slice(0, ndx);
		o.data = o.data.slice(ndx+1);
		if(line.length>0)
			mylog_tag(o.tag || false, o.name + ':' + line);
	}
}

function setup_wifiap()
{
	if(main.wifiap) return false; // we're already configured...
	var wifiap = {};

	var config = Network.config;
	var t, t2;
	var subnet = config.wifiap_subnet;
	t = subnet.split('/'); // '192.168.5.0/24'
	function subnet_bad()
	{
		mylog('The wifiap_subnet config (' + subnet + ') is invalid.');
		mylog(' The form is: a.b.c.d/e');
		mylog(' where a,b,c,d all are 0-255 and e is 16-29 (24 typical)');
		return false;
	}
	if(t.length != 2) return subnet_bad();
	if(t[1] < 16 || t[1] > 29) return subnet_bad();
	t2 = t[0].split('.');
	if(t2.length != 4) return subnet_bad();
	var s_network = 0;
	var s_size = 1 << (32 - t[1]);
	var s_mask = 0x100000000 - s_size;
	for(var i=0;i<4;++i)
	{
		if(t2[i]<0 || t2[i]>255)
			return subnet_bad();

		s_network = s_network*256 + parseInt(t2[i]);
	}
	s_network &= s_mask;
	function dot4(n)
	{
		return ((n>>24) & 255) + '.' + ((n>>16)&255) + '.' + ((n>>8)&255) + '.' + (n&255);
	}
	var ap_subnet = dot4(s_network) + '/' + t[1];
	var ap_ourip = dot4(s_network + 1);
	var ap_start = dot4(s_network + 2);
	var ap_end = dot4(s_network + s_size - 2);
	var ap_size = s_size - 3;
	var ap_mask = dot4(s_mask);
	var settings = {};
	settings.subnet = ap_subnet;
	settings.netmask = ap_mask;
	settings.ourip = ap_ourip;
	settings.start = ap_start;
	settings.end = ap_end;
	settings.size = ap_size;
	wifiap.settings = settings;
	mylog('wifiap settings:');
	show(settings);


	t = [];
	t.push('interface=wlan0');
	t.push('driver=nl80211');
	t.push('ssid=' + config.wifiap_ssid);
	t.push('channel=' + config.wifiap_channel);
	t.push('hw_mode=g');
	t.push('macaddr_acl=0');
	t.push('auth_algs=3');
	t.push('ignore_broadcast_ssid=0');
	t.push('wpa=2');
	t.push('#wpa=1');
	t.push('wpa_passphrase=' + config.wifiap_psk);
	t.push('wpa_key_mgmt=WPA-PSK');
	t.push('wpa_pairwise=TKIP');
	t.push('rsn_pairwise=CCMP');
	var hostapdfile = '/tmp/hostapd.conf';
	fs.writeFileSync(hostapdfile, t.join('\n'));
	killall(main, 'hostapd');

	wifiap.hostapd = {};

	if(true)
	{
		var args = [];
		args.push('/usr/sbin/hostapd');
		args.push(hostapdfile);
		function doit(args) {
			mylog('Spawning hostapd');
			var hostapd = wifiap.hostapd;
			hostapd.stdout = {name:'hostapd_stdout'};
			hostapd.stderr = {name:'hostapd_stderr'};
			var cmd = args.shift();
			hostapd.task = child_process.spawn(cmd, args);

			hostapd.task.stdout.on('data', function(data) {linelog(hostapd.stdout, data);});
			hostapd.task.stderr.on('data', function(data) {linelog(hostapd.stderr, data);});
			hostapd.task.on('close', function(code) {hostapd.task = false;});
		}
		main.docmd({func:doit, name:'spawn hostapd'}, args);
		main.dosleep(1); // add a 1 second sleep before any more commands...
	}

	main.docmd('/sbin/route', [ 'add', '-net', ap_subnet, 'dev', 'wlan0']);
	main.docmd('/sbin/ip', [ 'addr', 'add', ap_ourip, 'dev', 'wlan0']);

	var leasesfile = '/var/lib/misc/udhcpd.wlan0.leases';
	function writeleasefile() {
		fs.writeFileSync(leasesfile, '');
	}
	main.docmd({func:writeleasefile, name:'writeleasefile'});
	var udhcpdconf = '/tmp/udhcpd.conf';
	t = [];
	t.push('start           ' + ap_start); // 192.168.5.2
	t.push('end             ' + ap_end);   // 192.168.5.240
	t.push('option subnet   ' + ap_mask);  // 255.255.255.0
	t.push('option router   ' + ap_ourip); // 192.168.5.1');
	t.push('max_leases      ' + ap_size);  // 239
	t.push('option dns      8.8.8.8'); // HACK HACK HACK generate this
	t.push('interface       wlan0');
	t.push('lease_file      ' + leasesfile);
	t.push('option  lease   86400');
	t.push('pidfile         /var/run/udhcpd.wlan0.pid');
	fs.writeFileSync(udhcpdconf, t.join('\n'));

	wifiap.udhcpd = {};
	if(true)
	{
		var args = [];
		args.push('/usr/sbin/udhcpd');
		args.push('-f');
		args.push(udhcpdconf);
		function doit(args) {
			mylog('Spawning udhcpd');
			var udhcpd = wifiap.udhcpd;
			udhcpd.stdout = {name:'udhcpd_stdout'};
			udhcpd.stderr = {name:'udhcpd_stderr'};
			var cmd = args.shift();
			udhcpd.task = child_process.spawn(cmd, args);

			udhcpd.task.stdout.on('data', function(data) {linelog(udhcpd.stdout, data);});
			udhcpd.task.stderr.on('data', function(data) {linelog(udhcpd.stderr, data);});
			udhcpd.task.on('close', function(code) {udhcpd.task = false;});
		}
		main.docmd({func:doit, name:'spawn udhcpd'}, args);
		main.dosleep(1); // add a 1 second sleep before any more commands...
	}


	function activate_forwarding()
	{
		var cr = Network.currentroute;
		if(!cr || !cr.dev) return;

		var todev = cr.dev.device;
		function enable_ip_forward() {
			fs.writeFileSync('/proc/sys/net/ipv4/ip_forward', '1');
		}
		main.docmd({func:enable_ip_forward, name: 'enable_ip_forward'});
		main.docmd('/sbin/iptables', ['-F', '-t', 'nat']);
		main.docmd('/sbin/iptables', ['-F']);
		main.docmd('/sbin/iptables', ['-t', 'nat', '-A', 'POSTROUTING', '-o', todev, '-j', 'MASQUERADE']);
		main.docmd('/sbin/iptables', ['-A', 'FORWARD', '-i', todev, '-o', 'wlan0', '-m', 'state', '--state', 'RELATED,ESTABLISHED', '-j', 'ACCEPT']);
		main.docmd('/sbin/iptables', ['-A', 'FORWARD', '-i', 'wlan0', '-o', todev, '-j', 'ACCEPT']);
	}

	activate_forwarding();
	Network.emitter.on('newroute', activate_forwarding);
	wifiap.deactivate_forwarding = function() {
		Network.emitter.removeListener('newroute', activate_forwarding);
		wifiap.deactivate_forwarding = false;
	};
	main.wifiap = wifiap;
	return true;
}

function shutdown_wifiap()
{
	var wifiap = main.wifiap;
	if(!wifiap) return; // we haven't been setup
	main.wifiap = false;
	if(wifiap.deactivate_forwarding)
		wifiap.deactivate_forwarding();
	function stop_hostapd()
	{
		var hostapd = wifiap.hostapd;
		if(hostapd && hostapd.task)
		{
			mylog('Killing hostapd (wifiap)');
			hostapd.task.kill('SIGINT');
			hostapd.task = false;
		}
	}
	function stop_udhcpd()
	{
		var udhcpd = wifiap.udhcpd;
		if(udhcpd && udhcpd.task)
		{
			mylog('Killing udhcpd (wifiap)');
			udhcpd.task.kill('SIGINT');
			udhcpd.task = false;
		}
	}
	
	main.docmd({func:stop_hostapd, name: 'stop_hostapd'});
	main.docmd({func:stop_udhcpd, name: 'stop_udhcpd'});
	main.docmd('/sbin/iptables', ['-F', '-t', 'nat']);
	main.docmd('/sbin/iptables', ['-F']);
}

/*************************************************/
// General serial port read/write
/*************************************************/
var SerialPort = function(_name, sp_options)
{
	var myname = 'SerialPort_' + _name.replace(/\/dev\//g, "");
	var name = _name;
	var emitter = new events();
	var incoming = '';
	var opentimer = false;
	var errorCount = 0;
	var simModuleExist = false;
	const maxModules = 2;
	const maxErrorLimit = 30;
	const cellTypes = ['els31','sim7500a','sim5320'];
	var port = new sport(name, sp_options);
	var portready = false;
	port.on('open', function () {
		var msg = myname + ':Opened ' + name;
		mylog(msg);
		emitter.emit('open', msg);
		incoming = [];
		portready = true;
		simModuleExist = true;
		errorCount = 0;
		var config = JSON.parse(fs.readFileSync(Network.configfilename));
		if(config.cellular == 0)
			Network.config.cellular = config.cellular = 1;

		if(!config.cellular_type || config.cellular_type === 'wifi_only_hub') {
			Network.config.cellular_type = config.cellular_type = cellTypes[modulesCount];
			if(config.cellular_type == 'sim7500a'){
				Network.config.cellular_apn = config.cellular_apn = 'wireless.twilio.com';
			} else if(config.cellular_type == 'els31'){
				Network.config.cellular_apn = config.cellular_apn = 'vzwinternet';
			}
		}
		
		fs.writeFileSync(Network.configfilename, JSON.stringify(config));
	});
	port.on('error', function(err) {
		if(simModuleExist === false)
			errorCount++;

		if(errorCount === maxErrorLimit){
			if(modulesCount < maxModules){
				Network.devices['cellular'] = undefined;
				init_cellular(cellTypes[++modulesCount]);	
			} else {
				var config = JSON.parse(fs.readFileSync(Network.configfilename));
				Network.config.cellular = config.cellular = 0;
				Network.config.cellular_type = config.cellular_type = 'wifi_only_hub';
				fs.writeFileSync(Network.configfilename, JSON.stringify(config));
			}
			if(opentimer) {
				clearTimeout(opentimer);
				opentimer=false;
			}
		}
		if(portready)
		{
			mylog(myname + ':Error ' + err);
			portready = false;
		}
	});
	port.on('close', function() {
		mylog(myname + ':Closed ' + name);
		emitter.emit('close');
		portready = false;
		errorCount = 0;
	});
	port.on('data', function(data) {
		incoming += data.toString();
		var ndx;
		while((ndx = incoming.indexOf('\n')) >= 0)
		{
			++ndx;
			var line = incoming.slice(0, ndx).trim();
			incoming = incoming.slice(ndx);
			if(line=='') continue; // ignore empty lines
			var ds = datestring() + ' ';
			mylog_tag('sp', ds + 'sp:' + line);
			emitter.emit('line', line);
			if(Network.at_finished)
			{
				if(ATFinished(line))
				{
					var cb = Network.at_finished;
					Network.at_finished = false;
					cb();
				}
			}
		}
	});
	this.shutdown = function () {
		mylog(myname + ' shutdown');
		if(opentimer)
		{
			clearTimeout(opentimer);
			opentimer=false;
		}
		if(!portready) return;
		port.close(function (err) {
			portready=false;
		});
	};

	opentimer = setInterval(function () {
		if(portready) return;
		port.open();
	}, 1000);

	this.on = function(event, cb) {emitter.on(event, cb);return this;};
	this.once = function(event, cb) {emitter.once(event,  cb);return this;};
	this.emit = function(event, arg) {emitter.emit(event, arg);};
	this.send = function(data) {
		if(!portready)
			mylog('Port not ready...');
		else
			port.write(data.trim() + '\r\n');
	}

	this.status = function() {
		var res = {};
		res.name = name;
		res.open = portready;
		return res;
	};
	this.update = function(options, cb) {return port.update(options, cb);};

}


//function systemd(action, service, cb)
//{
//	var member = (action == 'stop') ? 'StopUnit' : 'StartUnit';
//	if(!service.match(/[.]service$/))
//		service += '.service';
//	bus.invoke({
//		path: '/org/freedesktop/systemd1', 
//		destination: 'org.freedesktop.systemd1', 
//		'interface': 'org.freedesktop.systemd1.Manager', 
//		member: member,
//		signature: 'ss',
//		body: [ service, 'replace' ],
//	}, function(err) {
//		if(err) cb(err);
//		else cb(null);
//	});
//}

function find_cellular() {return Network.find('cellular');}
var cell_power_manager = function () {
	mylog('cell_power_manager started');
	var pins = {};

	pins.power = board.sim_pwr;
	pins.reset = board.sim_rst;
	pins.button = board.sim_btn;

// The BBB sim5320 board makes use of the sim_rst pin, 1 means reset is asserted
// The A20 boards before cubie inverted the logic, so 0 means reset is asserted
// The cubie boards seem to go back to the bbb approach, but the reset seems to do nothing...

	function step1() {
		mylog('cellular power off / button off / reset off');
		pins.reset.writeSync(0);
		pins.power.writeSync(0);
		pins.button.writeSync(0);
	}

	function step2() {
		mylog('cellular power on / button off / reset off');
		pins.reset.writeSync(0);
		pins.power.writeSync(1);
		pins.button.writeSync(0);
	}

	function step2_bbb() {
		mylog('cellular power on / button off / reset on');
		pins.reset.writeSync(1);
		pins.power.writeSync(1);
		pins.button.writeSync(0);
	}

	function step3() {
		mylog('cellular power on / button on / reset off');
		pins.reset.writeSync(0);
		pins.power.writeSync(1);
		pins.button.writeSync(1);
	}

	var power_off_time = 7; // in seconds, enough time to discharge capacitors
	var poweroff = this.poweroff = function()
	{
		var q = find_cellular();
		if(!q) return;
		q.docmd({func:step1, name:'step1_shutdown'});
		q.dosleep(power_off_time);
	}
	this.poweron = function() {
		var q = find_cellular();
		if(!q) return;
		q.docmd({func:step1, name:'step1_poweron'});
		q.dosleep(power_off_time); // TODO: This logic could be improved, no need to wait if it has been off...
		if(Network.flags.is_bbb)
		{
			q.docmd({func:step2_bbb, name:'step2_bbb_poweron'});
			q.dosleep(.2);
		}
		q.docmd({func:step2, name:'step2_poweron'});
		q.dosleep(1);
		q.docmd({func:step3, name:'step3_poweron'});
		q.dosleep(1);
		q.docmd({func:step2, name:'step2_poweron'});
	};
	this.shutdown = function() {
		mylog('cell_power_manager shutdown');
		poweroff();
	}
}

function chatter(_stater, _dev, options)
{
	var state;
	var stater = _stater;
	var dev = this.dev = _dev;
	if(!options) options={};
	this.init = function() {
		state = {first: true, finished: false, dev: dev, options: options};
	}

	this.init();
	this.feed = function(line) {
		if(!state.finished && !state.first)
			stater(line, state); // passing a line we just received from the serial port, stater updates its state
	}
	this.msg = function() {
		if(state.finished)
			return false;
		return stater(false, state); // passing false to the stater means we want to know if has a command for us
	}
}

function ATFinished(line) {
	var t = line.toUpperCase();
	return t=='OK' || t=='ERROR' || t=='NO CARRIER';
}

function cell_chatmanager(serialport, dev, sp_options)
{
	var cm = this;
	cm.connect_timer = 0;
	cm.connect_period = 5; // seconds
	var sp = cm.sp = new SerialPort(serialport, sp_options);
	var open = false;

	sp.on('open', function() {open = true;cm.chat_init();});
	sp.on('close', function() {open = false;dev.atq = false;if(!dev.flags.preserve_settings) dev.settings = {};});

	sp.on('line', function(line) {
		cm.chat_feed(line);
	});

	cm.shutdown = function () {
		mylog('cell_chatmanager shutdown');
		if(sp) {sp.shutdown();sp=false;}
	}
	var chats = [];
	cm.chat_add = function(stater, options) {
		var t = new chatter(stater, dev, options);
		chats.push(t);
	}
	cm.chat_init = function() {
		dev.atq = [];
		chats.forEach(function(o) {o.init();});
	}
	cm.chat_feed = function(line) {
		chats.forEach(function(o) {
			if(o.first) return; // hasn't even started yet
			if(o.finished) return; // it's all done
			o.feed(line);
		});
		if(ATFinished(line)) {
			setATTimeout(0);
			cm.tryAT(1);
		}
	}
	cm.chat_msg = function() {
		var msg = false;
		chats.forEach(function(o) {
			if(msg) return;
			msg = o.msg();
		});
		return msg;
	}

	function setATTimeout(v) {
		v=(v===undefined) ? cm.connect_period : v;
		cm.connect_timer = Network.clock + v;
	}
	cm.tryAT = function(which) {
		if(!open) return;
		var hist = cm.ATHist = (cm.ATHist || []);
		var now = new Date().getTime() * .001;
		while(hist.length>0 && now >= hist[0]+1.0) hist.shift();
		if(hist.length >= 10) { // max per second
			setTimeout(function() {cm.tryAT(2);}, 100);
			return;
		}
		var msg = false;
		if(!msg) msg = cm.chat_msg();

		if(msg && msg!==true) // if the stater for a chatter returns true, it is busy... and no other chatters are invoked
		{
//			mylog('tryAT ' + which + ', sending ' + msg);
			hist.push(now);
			setATTimeout();
			sp.send(msg);
		}
	}

	cm.pulse = function() {
		var clock = Network.clock;
		if(!open) return;
		if(clock >= cm.connect_timer)
			cm.tryAT(3);
	}
}

//********************************************
// AT command serial port message handlers
// They all take 2 arguments:
//   The 1st is the line we just received over the serial port, or false
//   the second is the state object
// If the line is false, then we need to decide whether to return an AT command
//     If we return true (instead of an AT command) that means we're busy and
//     we don't want any other message handler to get a chance to send a command
// Otherwise we process the line and update our state
//********************************************

// if line is false, we need to return an AT command (if we want to send one), or false
// otherwise we need to process the line and update the state

function stater_atq(line, state) {
	var dev = state.dev;
	if(line===false) {
		if(dev.atq && dev.atq.length>0)
			return dev.atq.shift();
		return false;
	}
}

// els31 has annoying habit of going offline. We can look at "at+cereg?" and if it is x,4
// we issue at+cfun=0 then at+cfun=1 a few seconds later
function stater_els31hack(line, state) {
	var dev = state.dev;
	var clock = Network.clock;
	if(state.first)
	{
		state.first = false;
		state.period = 17;
		state.next_time = clock + state.period;
		state.cereg='';
		state.activity='';
	}
	if(line === false)
	{
		if(clock<state.next_time) return false;
		switch(state.activity) {
		case '':
		default:
			if(state.cereg=='xxx') {
				mylog('els31hack forcing toggle of cfun');
				state.cereg='';
				state.activity='step2';
				state.next_time = clock + 5;
				return 'AT+CFUN=0';
			}
			state.next_time = clock + state.period;
			return 'AT+CEREG?';
		case 'step2':
			state.activity='';
			state.next_time = clock+5;
			return 'AT+CFUN=1';
		}
	}
// otherwise we're looking for the report
	var m = /^\+CEREG: (.*)/.exec(line);
	if(!m) return;
	m = m[1].split(',');
	if(m.length<2) return;
	m=m[1];
	m = (m=='1') ? '1' : 'x';
	state.cereg = (m + state.cereg).slice(0,3);
}

function stater_ati(line, state)
{
	var dev = state.dev;
	if(state.first)
	{
		state.first = false;
		state.ati = [];
		if(state.options.cmd)
			return state.options.cmd;
		return 'ATI';
	}
	var ati = state.ati;
	if(!ati) return; // should never happen...
//	if(ati.length==0) // we're waiting for ATI
//	{
//		if(line == 'ATI')
//			ati.push(line);
//		return;
//	}
		// process lines as they come in until we get ok.
	if(line=='OK')
	{
		dev.settings.ati = ati.slice(1); // skip the first ATI line
		state.finished = true;
	} else
	{
		if(line.length)
			ati.push(line);
	}
}

function stater_ati1(line, state)
{
	var dev = state.dev;
	if(state.first)
	{
		state.first = false;
		state.ati1 = [];
		if(state.options.cmd)
			return state.options.cmd;
		return 'ATI1';
	}
	var ati1 = state.ati1;
	if(!ati1) return; // should never happen...
	if(line=='OK')
	{
		dev.settings.ati1 = ati1.slice(1); // skip the first ATI line
		state.finished = true;
	} else
	{
		if(line.length)
			ati1.push(line);
	}
}

// options.cmd
// options.member = string, where in settings to put the gathered report
// options.period = optional period in seconds, defaults to being one-shot
function stater_generic(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	var options = state.options;
	if(state.first)
	{
		state.first = false;
		state.next_time = clock;
	}
	if(line === false)
	{
		if(clock >= state.next_time) {
			state.next_time = clock + 99999;
			state.generic = [];
			state.gathering = true;
			return options.cmd || 'AT';
		}
		return false;
	}
	var generic = state.generic;
	if(!generic) return; // should never happen...
	if(!state.gathering) return;
// process lines as they come in until we get ok.
	if(line=='OK')
	{
		dev.settings[options.member || 'generic'] = generic.slice(1); // skip the first AT line
		if(options.period) state.next_time = clock + options.period;
		else state.finished = true;
		state.gathering=false;
	} else
	{
		if(line.length)
			generic.push(line);
	}
}

function stater_csq(line, st)
{
	var dev = st.dev;
	var clock = Network.clock;
	var opts = st.options;
	if(st.first)
	{
		st.first = false;
		st.next_time = clock;
		st.period = opts.period || 60;
		dev.settings.csq = false;
	}
	if(line === false)
	{
		if(clock<st.next_time) return false;
		st.ping = !st.ping;
		if(st.ping && opts.updatecmd) {
			st.period = 300;
			return opts.updatecmd;
		}
		st.next_time = clock + st.period;
		return opts.cmd || 'AT+CSQ';
	}
// otherwise we're looking for the report
	var m = /^\+[cC][sS][qQ]: (.*)/.exec(line);
	if(m) dev.settings.csq = m[1];
}

function stater_cbc(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	if(state.first)
	{
		state.first = false;
		state.next_time = clock;
		dev.settings.volts = false;
	}
	if(line === false)
	{
		if(clock >= state.next_time)
		{
			state.next_time = clock + 60;
			if(state.options.cmd)
				return state.options.cmd;
			return 'AT+CBC';
		}
		return false;
	}
// otherwise we're looking for the report
	var m = /^\+[cC][bB][cC]: (.*)/.exec(line);
	if(m) dev.settings.volts = m[1];
}

function stater_pcvolt(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	if(state.first)
	{
		state.first = false;
		state.next_time = clock;
		dev.settings.volts = false;
	}
	if(line === false)
	{
		if(clock >= state.next_time)
		{
			state.next_time = clock + 60;
			if(state.options.cmd)
				return state.options.cmd;
			return 'AT!PCVOLT?';
		}
		return false;
	}
// otherwise we're looking for the report
// Power supply voltage: 3345 mV
	var m = /^Power supply voltage: (.*)/.exec(line);
	if(m) {
		var t = m[1].split(' ');
		if(t.length==2) {
			t=t[0];
			t=t.slice(0,1) + '.' + t.slice(1) + 'V';
			dev.settings.volts = t;
		}
	}
}

function stater_sbv(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	if(state.first)
	{
		state.first = false;
		state.next_time = clock;
		dev.settings.volts = false;
	}
	if(line === false)
	{
		if(clock >= state.next_time)
		{
			state.next_time = clock + 60;
			if(state.options.cmd)
				return state.options.cmd;
			return 'AT^SBV';
		}
		return false;
	}
// otherwise we're looking for the report
// ^SBV: 3959
	var m = /^\^SBV: (.*)/.exec(line);
	if(m) {
		var t = m[1];
		t=t.slice(0,1) + '.' + t.slice(1) + 'V';
		dev.settings.volts = t;
	}
}

function stater_ipr(line, state)
{
	var dev = state.dev;
	if(state.first)
	{
		state.first = false;
		if(!state.options.baud) state.options.baud = 921600;
	}
	if(line === false)
	{
		return 'AT+IPR=' + state.options.baud;
	}
	if(/^OK/.exec(line))
	{
		state.finished = true;
		if(dev.cm && dev.cm.sp)
			dev.cm.sp.update({baudRate: state.options.baud}, state.options.cb);
	}
}


function stater_dial(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	if(state.first)
	{
		state.first = false;
		state.sent = false;
		if(!state.options.cmd) state.options.cmd = 'ATD*99#';
		if(!state.options.timeout) state.options.timeout = 22;
		dev.settings.dialed = false;
	}
	if(line === false)
	{
		if(!cgreg_good(dev)) return false; // || !creg_good(dev)
		if(state.sent) return true; // don't do anything until we're done...
		state.sent = clock;
		return state.options.cmd;
	}
	if(/^CONNECT/.exec(line))
	{
		state.finished = true;
		dev.settings.dialed = 'success';
	} else if(/^NO/.exec(line))
	{
		state.finished = true;
		dev.settings.dialed = 'fail';
	}
}

// els31 sends ^SYSSTART when ready
function stater_sysstart(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	state.first = false;
	if(line === false)
	{
		return true;
	}
	if(line=='^SYSSTART')
	{
		state.finished = true;
	}
}

// Keep sending blank AT commands until OK
function stater_first_at(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	state.first = false;
	if(line === false)
	{
		return 'AT';
	}
	if(line=='OK')
	{
		state.finished = true;
	}
}

function stater_at(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	if(state.first)
	{
		state.first = false;
		state.next_time = clock;
		state.fails = 0;
	}
	if(line === false)
	{
		if(clock >= state.next_time)
		{
			state.next_time = clock + 31;
			++state.fails;
			if(state.fails == 4)
			{
				mylog('!!!!! serial port not responding !!!!!');
				dev.toggle();
			}
			return 'AT';
		}
		return false;
	}
	if(line=='OK')
		state.fails = 0;
}

function secondOrFirst(m) {
	var l = m[1].split(',');
	return l.length>1 ? l[1] : l[0];
}

function stater_creg(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	if(state.first)
	{
		state.first = false;
		state.next_time = clock;
		dev.settings.creg = undefined;
	}
	if(line === false) // we need to decide whether to return an at+creg? command message
	{
		if(clock < state.next_time)
			return false;
		state.next_time = clock+11;
		return 'AT+CREG?';
	}
// otherwise we're looking for the report
	var m = /^\+CREG: (.*)/.exec(line);
	if(m) dev.settings.creg = secondOrFirst(m);
}

function stater_cgreg(line, st)
{
	var dev = st.dev;
	var clock = Network.clock;
	var opts = st.options;
	if(st.first)
	{
		st.first = false;
		st.next_time = clock;
		st.period = opts.period || 11;
		dev.settings.cgreg = undefined;
	}
	if(line === false) // we need to decide whether to return an at+cgreg? command message
	{
		if(dev.settings.cgreg !== undefined && clock < st.next_time)
			return false;
		st.ping = !st.ping;
		if(st.ping && opts.updatecmd) {
			st.period = 300;
			return opts.updatecmd;
		}
		st.next_time = clock+st.period;
		return opts.cmd || 'AT+CGREG?';
	}
// otherwise we're looking for the report
	var m = /^\+CGREG: (.*)/.exec(line);
	if(m) dev.settings.cgreg = secondOrFirst(m);
}

function creg_good(dev)
{
	return dev && dev.settings && dev.settings.creg==1;
}
function cgreg_good(dev)
{
	// settings.cgreg => 1 is on home network, => 5 is for roaming network
	return dev && dev.settings && (dev.settings.cgreg==1 || dev.settings.cgreg==5);
	//return dev && dev.settings && dev.settings.cgreg==1;
}
function invalidate_cgreg(dev) {
	if(dev && dev.settings) dev.settings.cgreg = undefined;
}
function rmcall_good(dev)
{
	return dev && dev.settings && dev.settings.rmcall==':1,V4';
}
function cpsi_good(dev)
{
	var res = dev && dev.settings && dev.settings.cpsi;
	if(res) {
		var l = dev.settings.cpsi.split(',');
		res = l.length>=2 && l[1]=='Online' && l[0]!='NO SERVICE';
	}
	return res;
}
function cpsi_bad(dev)
{
	var res = dev && dev.settings && dev.settings.cpsi;
	if(res) {
		var l = dev.settings.cpsi.split(',');
		res = l.length>=2 && l[1]=='Online' && l[0]=='NO SERVICE';
	}
	return res;
}

function stater_sqnautointernet(line, state)
{
	var dev = state.dev;
	if(state.first)
	{
		state.first = false;
		dev.settings.sqnautointernet = false;
		state.sqnautointernet = {};
	}
	var st = state.sqnautointernet;

	if(line === false) // we need to decide whether to return an AT command message
	{
		if(st.wait_ok) return false; // we're waiting for ok

		if(!st.have_asked)
		{
			st.have_asked = true;
			st.wait_ok = true;
			return 'AT+SQNAUTOINTERNET?';
		}
		if(st.value == '0')
		{
			st.have_asked = false;
			st.wait_ok = true;
			return 'AT+SQNAUTOINTERNET=1';
		}
		if(st.value == '1')
		{
			st.finished = true;
			return false; // we don't need to do anything
		}
		return false; // catchall
	}
	if(st.wait_ok)
	{
		if(line == 'OK')
		{
			st.wait_ok = false;
			return;
		}
		// We're dealing with lines as they come in...
		var m = /^\+SQNAUTOINTERNET: (.*)/.exec(line);
		if(m)
		{
//			mylog('sqnautointernet = ' + m[1]);
			dev.settings.sqnautointernet = st.value = m[1];
		}
	}
}

function stater_udusbcomp(line, state)
{
	var dev = state.dev;
	if(state.first)
	{
		state.first = false;
		state.udusbcomp = {};
	}
	var st = state.udusbcomp;
	if(line === false) // we need to decide whether to return an AT command message
	{
		if(st.wait_ok) return false; // we're waiting for ok
		if(!st.have_unlocked)
		{
			st.have_unlocked = true;
			st.wait_ok = true;
			return 'AT!ENTERCND="A710"';
		}
		if(!st.have_asked)
		{
			st.have_asked = true;
			st.wait_ok = true;
			return 'AT!UDUSBCOMP?';
		}
		var desired = 7; // 6 or 7
		if(state.options.value)
		{
			var v = state.options.value;
			if(v==6 || v==7)
				desired = v;
			else
				mylog('udusbcomp can only be 6 or 7');
		}
		if(st.udusbcomp != desired)
		{
			st.want_reset = true;
			st.have_asked = false;
			st.wait_ok = true;
			return 'AT!UDUSBCOMP=' + desired;
		} else
		{
			if(st.want_reset)
			{
//				st.want_reset = false;
				return 'AT!RESET';
			} else
				st.finished = true;
		}
		return false;
	}
	if(st.wait_ok)
	{
		if(line == 'OK')
		{
			st.wait_ok = false;
			return;
		}
		// We're dealing with lines as they come in...
		var m = /^!UDUSBCOMP: (.*)/.exec(line);
		if(m)
		{
			mylog('udusbcomp = ' + m[1]);
			st.udusbcomp = m[1];
		}
	}
}

function stater_pbdone(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	var st = state;
	if(st.first)
	{
		st.first = false;
		st.header = [];
		st.starttime = clock;
	}
	function done(msg)
	{
		mylog(msg);
		st.finished = true;
		dev.settings.startmsg = st.header;
	}
	if(line === false) // we need to decide whether to return an AT command message
	{
		var timeout = 5; // seconds to timeout once we start getting lines
		var elapsed;
		if(st.lastline) elapsed = clock - st.lastline;
		else {elapsed = clock - st.starttime;timeout *= 9;} // allow much more time for chip to power up
		if(elapsed > timeout)
		{
			done('Timeout (' + elapsed + ' seconds) waiting for "PB DONE", got ' + st.header.length + ' lines');
			if(!st.gotstart)
				dev.toggle();
		}
		return !st.finished; // hold off everything until we get PBDONE or timeout
	}
	st.lastline = clock;
	if(line.length) st.header.push(line);
	if(!st.gotstart && line=='START') st.gotstart = true;
	if(/^PB DONE/.exec(line))
		done('Got "PB DONE"');
}

function stater_cpin(line, state) {
	var clock = Network.clock;
	var st = state;
	var dev = state.dev;
	if(st.first) {
		st.first = false;
		st.starttime = clock;
	}
	function done() {
		st.finished = true;
	}
	if(line === false) {
		var timeout = 5; // seconds to timeout once we start getting lines
		var elapsed;
		if(st.lastline) elapsed = clock - st.lastline;
		else {elapsed = clock - st.starttime;timeout *= 9;} // allow much more time for chip to power up
		if(elapsed > timeout)
		{
			done();
			if(!st.gotstart)
				dev.toggle();
		}
		return !st.finished; // hold off everything until we get the sim status or timeout
	}
	st.lastline = clock;
	if(!st.gotstart && line=='START') st.gotstart = true;
	if(/^\+CPIN: (.*)/.exec(line))
		done();
}

function stater_cfun(line, st) {
	var dev = st.dev;
	var ds = dev.settings;
	if(st.first)
	{
		st.first = false;
		ds.cfun = false;
	}
	if(line === false) // we need to decide whether to return an AT command message
	{
		if(ds.cfun===false) return 'AT+CFUN?';
		if(ds.cfun==1) return false; // already is 1
		ds.cfun = false;
		return 'AT+CFUN=1';
	}
	var m = /^\+CFUN: (.*)/.exec(line);
	if(m) {
		ds.cfun = m[1];
	}
}

function stater_scfg_cfun(line, st) {
	var dev = st.dev;
	var ds = dev.settings;
	if(st.first)
	{
		st.first = false;
		ds.cfun_persist = false;
		st.tries = 0;
	}
	if(line === false) // we need to decide whether to return an AT command message
	{
		if(st.tries>4) return false; // only try so many times...
		if(ds.cfun_persist===false) return 'at^scfg="MEopMode/CFUN"';
		if(ds.cfun_persist=='"0"') return false; // already is what we want
		ds.cfun_persist = false;
		++st.tries;
		return 'AT^SCFG="MEopMode/CFUN",0';
	}
	var m = /^\^SCFG: (.*)/.exec(line);
	if(m) {
		var t = m[1].split(',');
		if(t.length>=2 && t[0]=='"MEopMode/CFUN"')
			ds.cfun_persist = t[1];
	}
}

function stater_rmcall(line, st)
{
	var dev = st.dev;
	var ds = dev.settings;
	var clock = Network.clock;
	if(st.first)
	{
		st.first = false;
		ds.rmcall = false;
		st.maxBadTime = 30;
	}
	function delay(seconds) {
		if(seconds) {
			st.delay = clock + seconds;
			return;
		}
		if(!st.delay) return false;
		if(clock < st.delay) return true;
		st.delay = false;
		return false;
	}
	function delayedCommand(seconds, command) {
		st.dc = command;
		delay(seconds);
	}
	if(line === false) // we need to decide whether to return an AT command message
	{
		if(delay()) return true; // WAIT
		if(st.dc) {
			var t = st.dc;
			st.dc=false;
			return t;
		}
		if(st.nocarrier) {
			st.nocarrier=false;
			return 'AT+CFUN=6';
		}
		var cando = cgreg_good(dev) && cpsi_good(dev); // && creg_good(dev)
		if(!cando) st.cando_start = false;
		else {
			if(!st.cando_start) st.cando_start = clock;
		}
		if(!cando && !st.badTime && !st.toggle && cpsi_bad(dev)) { // prepare to toggle cfun
			mylog('Preparing to toggle cfun, starting out badTime');
			st.badTime=clock;
		}
		if(!st.toggle && !cando && st.badTime && clock>st.badTime+st.maxBadTime) {
			mylog('Toggling cfun 0 to 1 because of badTime too long (' + st.maxBadTime + ' seconds)');
			st.toggle = {step:0};
			st.badTime=false;
		}
		if(st.toggle) {
			if(st.toggle.step==0) {
				++st.toggle.step;
				st.toggle.now=clock;
				return 'AT+CFUN=0';
			}
			if(st.toggle.step==1) {
				++st.toggle.step;
				delay(1);
				return true; // WAIT
			}
			if(st.toggle.step==2) {
				st.toggle=false;
				return 'AT+CFUN=1';
			}
		}
// if cando is false we can trust it, but if it is true it must stay true for a while
		if(!rmcall_good(dev) && cando && clock > st.cando_start + 3) {
			st.cando_start = false;
			return 'AT$QCRMCALL=1,1';
		}
		return false;
	}
	var m;
	if(m = /^\$QCRMCALL(.*)/.exec(line))
	{
		var oldgood = rmcall_good(dev);
		ds.rmcall = m[1].replace(/ /g, '');
		var newgood = rmcall_good(dev);
		mylog('rmcall = "' + ds.rmcall + '"' + (!newgood ? ' (bad)' : ''));
		if(newgood) {
			st.sent = false;
			st.badTime=false;
		} else {
			if(oldgood) { // we went from good to bad
				invalidate_cgreg(dev);
				do_down(dev); // want to invalidateDHCP and remove IP configuration
				delay(3); // give cgreg a chance to catch up
			}
		}
	} else if(line=='NO CARRIER') {
// NO CARRIER occured on reboot version 2.36. cfun toggle didn't fix it. at+creset fixed it
// trouble seems to be cgreg is too slow to update
		invalidate_cgreg(dev);
		mylog('******** NO CARRIER problem occured in stater_rmcall');
		st.nocarrier=true;
	}
}

function stater_cpsi(line, st)
{
	var dev = st.dev;
	var clock = Network.clock;
	var opts = st.options;
	if(st.first)
	{
		st.first = false;
		dev.settings.cpsi = false;
		st.period = opts.period || 10;
		st.next_time = clock;
	}
	if(line === false) // we need to decide whether to return an AT command message
	{
		if(clock < st.next_time) return false;
		st.ping = !st.ping;
		if(st.ping && opts.updatecmd) {
			st.period = 300;
			return opts.updatecmd;
		}
		st.next_time = clock + st.period;
		return opts.cmd || 'AT+CPSI?';
	}
	var m = /^\+CPSI: (.*)/.exec(line);
	if(m)
		dev.settings.cpsi = m[1];
}

function stater_apn(line, state)
{
	var dev = state.dev;
	if(state.first)
	{
		state.first = false;
		dev.settings.apn = false;
	}
	if(line === false) // we need to decide whether to return an AT command message
	{
		if(Network.config.cellular_apn != dev.settings.apn)
		{
			dev.settings.apn = Network.config.cellular_apn;
			return 'AT+CGDCONT=1,"IP","' + dev.settings.apn + '"';
		}
		return false;
	}
}

function stater_cnmp(line, state)
{
	var dev = state.dev;
	if(state.first)
	{
		state.first = false;
		state.cnmp = false;
	}
	var val = Network.config.cellular_cnmp;
	if(line === false) // we need to decide whether to return an AT command message
	{
		if(val != '' && val != state.cnmp)
		{
			state.cnmp = val;
			dev.settings.cnmp = false;
			return 'AT+CNMP=' + val;
		}
		if(dev.settings.cnmp===false || dev.settings.cnmp===undefined) {
			return 'AT+CNMP?';
		}
		return false;
	}
	var m = /^\+CNMP: (.*)/.exec(line);
	if(m) dev.settings.cnmp = m[1];
}

function stater_gstatus(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	if(state.first)
	{
		state.first = false;
		state.gstatus = [];
		state.next_gstatustime = clock;
		dev.settings.gstatus = false;
	}
	if(line === false)
	{
		if(clock >= state.next_gstatustime)
		{
			state.gstatus = [];
			state.finished = false;
			state.next_gstatustime = clock + 12;
			if(state.options.cmd)
				return state.options.cmd;
			return 'AT!GSTATUS?';
		}
		return false;
	}
	if(!state.gstatus) return;
	// process lines as they come in until we get ok.
	if(line=='OK')
	{
		dev.settings.gstatus = state.gstatus.slice(1); // skip the first ATI line
		state.gstatus = false;
		dev.settings.gstatus.forEach(function(l) {
			var m = /Temperature: (.*)/.exec(l);
			if(m) dev.settings.temperature = m[1];
		});
	} else
	{
		if(line.length)
			state.gstatus.push(line);
	}
}

function stater_cpmutemp(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	if(state.first)
	{
		state.first = false;
		state.next_time = clock;
	}
	if(line === false)
	{
		if(clock >= state.next_time)
		{
			state.next_time = clock + 60;
			if(state.options.cmd)
				return state.options.cmd;
			return 'AT+CPMUTEMP';
		}
		return false;
	}
//+CPMUTEMP: 40
// otherwise we're looking for the report
	var m = /^\+CPMUTEMP: (.*)/.exec(line);
	if(m) dev.settings.temperature = m[1];
}

function stater_sctm(line, state)
{
	var dev = state.dev;
	var clock = Network.clock;
	if(state.first)
	{
		state.first = false;
		state.next_time = clock;
		state.setup = false;
	}
	if(line === false)
	{
		if(!state.setup)
		{
			state.setup = true;
			return 'AT^SCTM=0,1';
		}
		if(clock >= state.next_time)
		{
			state.next_time = clock + 60;
			if(state.options.cmd)
				return state.options.cmd;
			return 'AT^SCTM?';
		}
		return false;
	}
//^SCTM: 0,0,26

// otherwise we're looking for the report
	var m = /^\^SCTM: (.*)/.exec(line);
	if(m)
	{
		var t = m[1].split(',');
		dev.settings.temperature = t[2];
	}
}

function is_current_route(dev)
{
	var cr = Network.currentroute;
	if(!cr) return false;
	return cr.dev == dev;
}

function qminet(ss, cb, often)
{
	var dev = find_cellular();
	if(!dev)
	{
		if(cb)
			cb('qminet: No cellular device');
		return;
	}
	var tag = often ? 'often:' : '';
	dev.docmd(tag + '/usr/bin/qmi-network', ['/dev/cdc-wdm0', ss], cb);
	if(ss == 'stop')
	{
		invalidateDHCP(dev);
		if(is_current_route(dev))
			Network.deroute();
	}
}

function qmipoll(dev)
{
	if(!dev.settings) return;

	var qmi = dev.settings.qmi;
	if(!qmi)
		qmi_restart();

	function qmi_setup()
	{
		qminet('stop');
		dev.docmd('/usr/bin/qmicli', ['-d', '/dev/cdc-wdm0', '--wda-set-data-format=802-3']);
		qminet('start');
		dev.docmd({func:qmi_setlaststatus, name:'qmi_setlaststatus'});
	}

	function qmi_setlaststatus(normal)
	{
		qmi.laststatus = Network.clock;
		if(normal!==true)
		{
			qmi.laststatus+=10;
//			mylog('extra long... because it is the first time.');
		}
		qmi.setupdone = true;
	}

	function qmi_restart()
	{
		qmi = dev.settings.qmi = {};
	}

	function qmi_status()
	{
		if(!dev.settings.csq)
			return;
		if(!qmi.setupdone)
			return;
		var clock = Network.clock;
		if(qmi.laststatus && qmi.laststatus+5 > clock)
			return;
		qmi_setlaststatus(true);
		qminet('status', function(err, stdout) {
			if(err) qmi_restart();
			else
			{
				var connected = false;
				var lines = stdout.split('\n');
				lines.forEach(function(line) {
					var m;
					if (m = /^Status: (\S+)/.exec(line)) {
						qmi.status = m[1];
						if(m[1] == 'connected')
							connected = true;
					}
				});
			}
			if(!connected) qmi_restart();
		}, true);
	}

	if(dev.settings.csq && !qmi.setupdone && !qmi.setupstarted) {
		qmi.setupstarted = true;
		qmi_setup();
	}

	qmi_status();
}

function kill_pppd(dev)
{
	killall(dev, 'pppd');
}

function kill_cmux(dev)
{
	killall(dev, 'cmux');
}

function spawn_pppd(dev, serialdev, baud)
{
// /etc/ppp/peers script, to be called with "pppd call <filename>"
	kill_pppd(dev);
	dev.flags.pppd_active = false;
	var sss = [];
	var apn = Network.config.cellular_apn;
	apn = apn ? ' -T ' + apn : '';
	sss.push('connect "/usr/sbin/chat -v -f /etc/chatscripts/gprs' + apn + '"');
	sss.push(serialdev);
	sss.push(baud);
	sss.push('noipdefault');
	sss.push('usepeerdns');
	sss.push('nodefaultroute');
	sss.push('nopersist');
	sss.push('noauth');
	sss.push('nodetach');
	sss.push('nocrtscts');
	sss.push('local');
	sss.push('');
	sss = sss.join('\n');
	var name = 'networker';
	fs.writeFileSync('/etc/ppp/peers/' + name, sss);
//	dev.docmd('/usr/sbin/pppd', ['call', name]);

	var args = ['/usr/sbin/pppd', 'call', name];
	function pppd_doit(args) {
		mylog('Spawning pppd for ' + dev.technology);
		var cmd = args.shift();
		dev.flags.pppd_active = true;
		dev.pppd = child_process.execFile(cmd, args, function(err, stdout, stderr) {
			mylog('pppd for ' + dev.technology + ' terminated');
			if(err) mylog('err:' + err);
			if(stdout) mylog('stdout:' + stdout.trim());
			if(stderr) mylog('stderr:' + stderr.trim());
			dev.flags.pppd_active = false;
			delete dev.settings.manual;
			if(!dev.flags.goingoff && !Network.flags.shutdown)
				dev.toggle();
		});
	}
	dev.docmd({func:pppd_doit, name:'pppd_doit'}, args);
}

function is_exe(path)
{
	var res = false;
	try {
		fs.accessSync(path, fs.X_OK);
		res = true;
	} catch (e) {}
	return res;
}

function spawn_cmux(dev)
{
	kill_cmux(dev);
	function cmux_doit(args) {
		mylog('Spawning cmux for ' + dev.technology);
		var cmd = args.shift();
		dev.cmux = child_process.execFile(cmd, args, function(err, stdout, stderr) {
			mylog('cmux for ' + dev.technology + ' terminated');
			if(err) mylog('err:' + err);
			if(stdout) mylog('stdout:' + stdout.trim());
			if(stderr) mylog('stderr:' + stderr.trim());
			if(!dev.flags.goingoff && !Network.flags.shutdown)
				dev.toggle();
		});
	}
	var p1 = __dirname + '/cmux';
	var p2 = '/usr/local/bin/cmux';
	var args = [is_exe(p1) ? p1 : p2];
	dev.docmd({func:cmux_doit, name:'cmux_doit'}, args);
}

function config_ppp_manual(dev)
{
	var info = {};
	var f = false;
// 20170924 this file is written by /etc/ppp/ip-up.d/000pppstatus_up which is our script
	var fname = '/etc/ppp/ppp.status';
	try {
		f = fs.readFileSync(fname);
	} catch (e) {}
	if(!f) {mylog('config_ppp_manual: Could not read ' + fname);return;}
	f.toString().split('\n').forEach(function(l) {
		l = l.split('=');
		if(l.length != 2) return;
		var ls = l[0];
		var rs = l[1];
		if(ls.slice(0,4) != 'PPP_') return;
		ls = ls.slice(4);
		info[ls] = rs;
	});
	if(info.STABLE != 'true')
	{
		mylog('Imperfect read of pppd status file');
		return;
	}
	show(info);
	var manual = dev.settings.manual = {};
	dev.settings.ipaddr = manual.IPADDR = info.LOCAL;
	manual.GATEWAY = [info.REMOTE];
	manual.NAMESERVER = [];
	info.DNS1 && manual.NAMESERVER.push(info.DNS1);
	info.DNS2 && manual.NAMESERVER.push(info.DNS2);
	manual.routable = true;
}

function get_celltypes()
{
	return ['none', 'sim7500a', 'els31', 'mc7354', 'sim5320', 'wifi_only_hub'];
}
function init_cellular(type)
{
	if(find_cellular()) return;
	var local_type = Network.config.cellular_type;
	var arr = get_celltypes();
	if(!local_type || local_type == 'wifi_only_hub'){
		if(!alreadyCheckedPort.some(typ => arr.includes(typ))){
			if(!type){
				type = 'els31';
			} 
			alreadyCheckedPort.push(type);
		}
	} else {
		type = local_type;
	}
	var dev = false;
	var cm = false;

	function setup(options)
	{
		var netdev = options.netdev;
		var serialdev = options.serialdev;
		var sp_options = options.sp_options || undefined;
		var devopts = {device: netdev};
		dev_flaglist.forEach(function(f) {if(f in options) devopts[f] = options[f];});
		dev = new Network('cellular', devopts);
		if(options.earlyinit)
		{
			options.earlyinit.forEach(function (func) {
				func(dev);
			});
		}
		if(!Network.cpm)
			Network.cpm = new cell_power_manager(); // we only want one...
		dev.cpm = Network.cpm;
		dev.add_shutdown(dev.cpm.shutdown);
		dev.cpm.poweron();
		dev.pollfunc = false;
		function handle_cm() {
			cm = dev.cm = new cell_chatmanager(serialdev, dev, sp_options);
			dev.add_shutdown(dev.cm.shutdown);
			if(options.chats) {
				cm.chat_add(stater_atq);
				options.chats(dev);
			}
		}
		dev.docmd({func: handle_cm, name:'handle_cm'});
	}

	switch(type)
	{
	case 'sim7500a':
		setup({
			netdev: 'wwan0',
			serialdev: '/dev/ttyUSB2',
			chats: chats_sim7500a,
		});
		function chats_sim7500a(dev) {
	// Disabling stater_pbdone, part of OT254 function, as sim which doesn't return phonebook, should not be the blocking case
	// to further setup cellular network
	//		cm.chat_add(stater_pbdone);
			cm.chat_add(stater_cpin);
			cm.chat_add(stater_at);
			cm.chat_add(stater_cgreg, {updatecmd: 'AT+CGREG=1'});
//			cm.chat_add(stater_creg);
			cm.chat_add(stater_ati, {cmd: 'AT+SIMCOMATI'});
			cm.chat_add(stater_generic, {cmd: 'AT+CSUB', member: 'csub'});
			cm.chat_add(stater_generic, {cmd: 'AT+ICCID', member: 'iccid'});
			cm.chat_add(stater_generic, {cmd: 'AT+CIMI', member: 'imsi'});
			cm.chat_add(stater_apn);
			cm.chat_add(stater_csq, {updatecmd: 'AT+AUTOCSQ=1,1'});
			cm.chat_add(stater_cbc);
			cm.chat_add(stater_cnmp);
			var period = 11;
			cm.chat_add(stater_cpsi, {updatecmd: 'AT+CPSI=' + period, period:period});
			cm.chat_add(stater_rmcall);
			cm.chat_add(stater_cpmutemp);
		}
		dev.pollfunc = function() {
			var s = dev.settings;
			if(!s) return;
			var svn = 'xx';
			s.ati && s.ati.forEach(function(line) {
				if(line.slice(0,5)=='SVN: ')
					svn=line.slice(5);
			});
			var csub='yy';
			if(s.csub && s.csub[0] && s.csub[0].slice(0,7)=='+CSUB: ')
				csub=s.csub[0].slice(7);
			s.SVN=csub + svn;
		};
		dev.dhcpable = function() {
			return dev.prepared && rmcall_good(dev);
		}
		break;
	case 'els31':
		setup({
			netdev: uEnv.cfg_usbdev != '0' ? 'usb1' : 'usb0',
			serialdev: '/dev/ttyACM0',
			chats: chats_els31,
		});
		function chats_els31(dev) {
			cm.chat_add(stater_sysstart);
			cm.chat_add(stater_first_at);
			cm.chat_add(stater_scfg_cfun);
			cm.chat_add(stater_cfun);
			cm.chat_add(stater_ati);
			cm.chat_add(stater_ati1);
			cm.chat_add(stater_sqnautointernet);
			cm.chat_add(stater_sctm);
			cm.chat_add(stater_csq);
			cm.chat_add(stater_sbv);
			cm.chat_add(stater_els31hack);
		}
		dev.dhcpable = function() {
			return dev.settings.sqnautointernet == '1' && dev.settings.csq;
		};
		dev.mistrustDHCP = true;
		dev.pollfunc = function() {
			var s = dev.settings;
			if(!s) return;
			var svn = 'xx';
			if(s.ati1) {
				s.ati1.forEach(function(line) {
					var m = /A-REVISION (.*)/.exec(line);
					if(m) svn = m[1];
				});
			}
			s.SVN = svn;
		};
		break;
	case 'mc7354':
		setup({
			netdev: 'wwan0',
			serialdev: '/dev/ttyUSB2',
			chats: chats_mc7354,
		});
		function chats_mc7354(dev) {
			cm.chat_add(stater_ati);
//			cm.chat_add(stater_udusbcomp, {value: 6}); // this doesn't seem to be required
			cm.chat_add(stater_generic, {cmd: 'AT!gobiimpref?', member: 'gobiimpref'});
			cm.chat_add(stater_generic, {cmd: 'AT$prl?', member: 'prl', period:57});
			cm.chat_add(stater_gstatus);
			cm.chat_add(stater_csq, {cmd: 'AT+csq?'});
			cm.chat_add(stater_pcvolt);
		}
		dev.settings.qmidone = false;
		dev.pollfunc = function() {
			qmipoll(dev);
			var s = dev.settings;
			if(!s) return;
			var svn = 'xx';
			s.gobiimpref && s.gobiimpref.forEach(function(line) {
				if(line.slice(0,24)=='current fw version:     ')
					svn=line.slice(24).replace(/[.]/g, '');
			});
			var prl='yy';
			if(s.prl && s.prl[0] && s.prl[0].slice(0,9)=='PRL VER: ')
				prl=s.prl[0].slice(9);
			s.SVN=svn + '.' + prl;

			if(s.gstatus) {
				s.gstatus.forEach(function(line) {
					if(line.slice(0,12) != 'System mode:') return;
					s.SM=line.slice(12, 26).trim();
				});
			}
		};
		dev.dhcpable = function() {return dev.settings.csq;};
		break;
	case 'sim5320':
//at+ipr=921600
//at+iprex=921600
// https://www.npmjs.com/package/serialport
		setup({
			netdev: 'ppp0',
			serialdev: '/dev/ttyGSM3',
			sp_options: {baudRate: 115200, rtscts: false},
			earlyinit: [kill_pppd, spawn_cmux],
			passive_config: true,
			preserve_settings: true,
			chats: chats_sim5320,
		});
		dev.add_shutdown(function () {kill_pppd(dev);kill_cmux(dev);});
		dev.spawned_pppd = false;
		function chats_sim5320(dev) {
			dev.flags.baud = 921600;
//			var baud = 921600;
//			cm.chat_add(stater_pbdone);
//			cm.chat_add(stater_ipr, {baud: baud, cb: function(err) {
//					if(err) mylog('stater_baud err: ' + err); else dev.flags.baud = baud;}
//				});
			cm.chat_add(stater_at);
			cm.chat_add(stater_apn);
			cm.chat_add(stater_ati);
			cm.chat_add(stater_cpsi);
			cm.chat_add(stater_csq);
			cm.chat_add(stater_creg);
			cm.chat_add(stater_cgreg);
//			cm.chat_add(stater_dial, {cmd: 'ATD*99#'});
		}
		dev.dhcpable = function() {return false;}
		dev.pollfunc = function() {
			if(!creg_good(dev) || !cgreg_good(dev))
				return;
			if(!dev.spawned_pppd)
			{
				dev.spawned_pppd = true;
				spawn_pppd(dev, '/dev/ttyGSM4', dev.flags.baud);
			} else
			{
				if(dev.state.carrier == '1' && !dev.settings.manual)
					config_ppp_manual(dev);
			}
		};
		break;
	default:
		return;
	}
	dev.pulse = function() {
		cm && cm.pulse();
		if(dev.pollfunc) dev.pollfunc();
	}
}

/*************************************************/
// Our exports
/*************************************************/

var ex = module.exports;
ex.getlogger = function() {return logfunc;};
ex.logger = function(logger) {logfunc = logger;};
ex.version = function() {return myversion;}
ex.set = function(options, ctx, whatChanged) {return Network.set(options, ctx, whatChanged);}; // whatChanged gets filled in
ex.config = ex.set;
ex.get_all_flags = function() {
	var res = {};
	res.globals = Network.flags;

	Network.foreach(function(dev) {
		res[dev.technology] = dev.flags;
	});
	return res;
}
ex.scan = function(cb) {
	var o = Network.find('wifi');
	if(o)
	{
		o.once('scan', function(res) {cb(res);});
		o.scan();
	}
};
ex.scan_results = function() {
	var dev = Network.find('wifi');
	if(dev && dev.scan_results) return dev.scan_results;
	return [];
};

ex.info = function(technology) {
	var info = {};
	info.version = myversion;
	var wifiap = main.wifiap;
	info.wifiap_status = ((config.wifiap === '1') ? 1: 0);
	if(wifiap)
	{
		info.wifiap = {};
		if(wifiap.settings)
			info.wifiap.settings = wifiap.settings;
	}
	info.wifi_status = config['wifi'];
	info.technologies = {};
	Network.foreach(function (dev) {
		var tech = dev.technology;
		if(technology && tech != technology) return;
		var temp = info.technologies[tech] = {};
		temp.device = dev.device;
		temp.state = dev.state;
		temp.routable = dev.routable();
		if(tech == 'cellular' && dev.cm && dev.cm.sp)
			temp.sp = dev.cm.sp.status();
		if(dev.settings)
		{
			temp.settings = dev.settings;
			if(!dev.flags.passive_config)
				temp.dhcp_renewal = dev.dhcp_renewal();
		}
	});


	if(Network.config.monitor_active)
	{
		var o = info.netmon = {};
		o.reliability = netmon.reliability;
		o.last_msg = netmon.last_msg || {};
	}
	info.serial_no = Network.serial_no;
	info.raw_serial_no = Network.raw_serial_no;
	info.clock = Network.clock;
	info.currentroute = Network.route();
	info.date = ex.datestring();

	info.ssid = null;
	let networkType = info.currentroute.split(',');
	if(networkType[0] === "wifi"){
		let config = Network.config;
		info.ssid = config['wifi_ssid'];
	}

	return info;
};
ex.send = function(msg) {
	var cell = find_cellular();
	if(cell && cell.cm && cell.cm.sp && cell.atq)
		cell.atq.push(msg);
	else
		mylog('No serial control port available');
};
ex.at_finished = function(cb) {Network.at_finished = cb;}
ex.dhcp = function(tech, cb) {Network.dhcp(tech, cb);};
ex.celltypes = Network.celltypes;
ex.shutdown = function(cb) {Network.shutdown(cb);};
ex.connect = function(tech) {Network.connect(tech);};
ex.route = function(tech) {return Network.route(tech);};
ex.deroute = function() {Network.deroute();};
ex.settings = function(ctx) {return Network.getconfig(ctx);}
ex.showconfig = ex.settings;
ex.load_config = function(ctx) {Network.load_config(ctx);}
ex.save_config = function(ctx) {Network.save_config(ctx);}
ex.update_config = function(ctx, obj) {Network.update_config(ctx, obj);}
ex.view_config = function(ctx) {return Network.view_config(ctx);}
ex.diff_config = function() {return Network.diff_config();}
ex.myname = myname;
ex.confighelp = function() {return Network.confighelp();};
ex.sethelp = ex.confighelp;
ex.datestring = datestring;
ex.maketree = function(obj) {return pr.asTree(obj, true).trim();}
ex.add_ctx = function(ctx) {Network.add_ctx(ctx);};
ex.remove_ctx = function(ctx) {Network.remove_ctx(ctx);};
ex.logging = function() {return Network.logging_copy();};
ex.blacklist = function(tech) {return Network.blacklist(tech, true);}
ex.unblacklist = function(tech) {return Network.blacklist(tech, false);}
ex.verify = function(tech,cb,config) {return Network.verify(tech,cb,config);}
ex.toggle = function(tech) {return Network.toggle(tech);}
ex.netmon = function(par) {netmon_pulse(true, par);}

ex.qminet = function(ss, ctx)
{
	qminet(ss, function(err, stdout, stderr) {
		if(err)
			ctx.logger(err);
		else
		{
			if(stdout) ctx.logger(stdout);
			if(stderr) ctx.logger(stderr);
		}
	});
}
ex.history = function(n, ctx)
{
	if(n == 'a' || n == 'all') n = log_history.length;
	else
	{
		if(n) n = parseInt(n);
		else n=20;
	}
	if(log_history.length < n)
		n = log_history.length;
	var i = log_history.length - n;
	if(n>0)
	{
		function gap(c)
		{
			while(c--) ctx.logger('***************************************************************************');
		}
		gap(3);
		ctx.logger('    showing ' + n + ' log lines');
		gap(3);
		while(n--)
			ctx.logger(log_history[i++].msg);
	}
}
ex.init = function() {init_network(Network);}

/********************************************************/
// Example usage demonstrated with command line interface
// We only use the modules.export interface, "networker"
/********************************************************/

//var networker = require('networker.js');  // usual way to make use of this module
var networker = ex; // let's pretend
var rl = false;
var exitcode = 0;
var trigger_fileload = false;
var no_cmdline = false;
var am_relay = false;
var brief_log = true;
var submodule = (require.main !== module)  // we were require()'d
var listenerlog = false;
var current_clients = [];
var syslog_logger = false;
var to_syslog = false;
var syslog_q = [];

function opensyslog()
{
	syslog_logger = child_process.spawn('/usr/bin/logger', ['-t', 'networker'], {
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	syslog_logger.on('close', function(code) {
		syslog_logger = false;
		syslog('syslog process exited for some reason... respawning...');
		opensyslog();
	});
}

function syslog(msg)
{
	syslog_q.push(msg);
	out1();
	function out1()
	{
		if(!syslog_logger) return; // leave messages in q until logger can be respawned again
		var msg = syslog_q.shift();
		syslog_logger.stdin.write(msg + '\n', function(err, res) {
			if(syslog_q.length == 0) return;
			out1();
		});
	}
}

function ourlog()
{
	var args = arguments;
	if(!brief_log)
	{
		var ds = 'LOG-' + networker.datestring() + ':';
		var msg = '';
		for(var i=0;i<args.length;++i)
			msg += (i==0 ? '' : ' ') + args[i];
		msg.split('\n').forEach(function(line) {
			console.log(ds + line);
		});
	} else
	{
		if(to_syslog)
			Object.keys(args).forEach(function(k) {syslog(args[k]);});
		else
			console.log.apply(null, args);
	}
}
var sockname = '/tmp/networker.sock';
var pidfile = '/tmp/networker.pid';
function create_listener(logf)
{
	listenerlog = logf;
	var server = net.createServer(function(c) {
		logf('Client connect');

		var ctx = {c:c};
		ctx.send = function(o) {this.c.write(JSON.stringify(o) + '\0');}
		ctx.logging = networker.logging(); // grab copy of current log settings
		networker.add_ctx(ctx);
		current_clients.push(ctx);
		var incoming = '';
		ctx.logger = function()
		{
			var args = arguments;
			var msg = '';
			Object.keys(args).forEach(function(item) {msg += ' ' + args[item];});
			c.write(msg.trim() + '\n');
		}
		c.on('error', function() {logf('client error');disconnect_client(ctx);});
		c.on('end', function() {logf('client end');disconnect_client(ctx);});
		c.on('data', function(data) {
//			logf('data:' + data);
			incoming += data;
			for(;;)
			{
				var z = incoming.indexOf('\0');
				var n = incoming.indexOf('\n');
				if(z>=0 && (n<0 || n>z)) {
					var o = incoming.slice(0,z);
					incoming = incoming.slice(z+1);
					var obj = false;
					try {
						obj = JSON.parse(o);
					} catch(e) {}
					if(obj) {
						ctx.obj = true; // this connection is object kind, can rx events
						objectCommand(obj, ctx);
					}
					continue;
				}
				if(n>=0) {
					var line = incoming.slice(0, n);
					incoming = incoming.slice(n+1);
					userCommand(line, ctx);
				} else break;
			}
		});
		c.write('Hello from ' + myversion);
	});
	try {
		fs.unlinkSync(sockname);
	} catch(e) {}

	server.listen(sockname);
}
function disconnect_client(ctx)
{
	var active = [];
	current_clients.forEach(function(cc) {
		if(cc===ctx) {
			if(listenerlog) listenerlog('Closing client');
			ctx.c.destroy();
			networker.remove_ctx(ctx);
		} else
			active.push(cc);
	});
	current_clients = active;	
}
function write_pid()
{
	fs.writeFileSync(pidfile, process.pid);
}
function pid_valid()
{
	var ret = false;
	try {
		var x = fs.readFileSync(pidfile);
		x = parseInt(x);
		try {
			process.kill(x, 0);
			ret = x;
		} catch(e) {}
	} catch(e) {}
	return ret;
}
var pid = pid_valid();

if(submodule)
{
	if(!pid) // no other master active...
	{
		write_pid();
		function outerlog()
		{
			var args = arguments;
			(networker.getlogger() || console.log).apply(null, args);
		}
		create_listener(outerlog);
	}
	return; // if we were require'd, don't do any more...
}


ourlog('Standalone mode activated, we are version ' + version_string);

function quickcmd(cmd, ctx)
{
	child_process.exec(cmd, function(err, stdout, stderr) {
		if(err) ctx.logger('quickcmd err:' + err);
		if(stdout) ctx.logger('quickcmd stdout:' + stdout.trim());
		if(stderr) ctx.logger('quickcmd stderr:' + stderr.trim());
	});
}
quickcmd('sudo apt install chrony',);
var pre_execute = [];
function helptext()
{
	ourlog('Options:');
	ourlog('   -h           = show this help text');
	ourlog('   -v           = show version then exit');
	ourlog('   -l           = do "file load"');
	ourlog('   -n           = do not launch commandline interface');
	ourlog('   -b           = brief log lines (no LOG-{datestamp})');
	ourlog('   -ds          = add datestap to log lines (LOG-{datestamp})');
	ourlog('   -x <cmd>     = execute a single command (-x "set log=+sp")');
	process.exit(0);
}
for(var count=2;process.argv[count];++count)
{
	var arg = process.argv[count];
	var nextarg = process.argv[count+1];
//	ourlog("argv[" + count + "] = " + arg);
	if(arg == "-h") {
		helptext();
	} else if(arg == "-v") {
		ourlog(networker.version());
		process.exit(0);
	} else if(arg == '-l') trigger_fileload = true;
	else if(arg == '-n') no_cmdline = true;
	else if(arg == '-b') brief_log = true;
	else if(arg == '-ds') brief_log = false;
	else if(arg == '-x')
	{
		if(nextarg)
		{
			pre_execute.push(nextarg);
			++count;
		}
		else helptext();
	} else helptext();
}

function doquit(code)
{
	if(!code) code=0;
	exitcode = code;
	ourlog('\nExiting... exitcode=' + exitcode + '\n');
	process.exit(code);
}

if(pid)
{
	ourlog('There is a running networker.js master process @ pid ' + pid);
	if(no_cmdline)
	{
		ourlog('... Your use of the "-n" option is meaningless in this case. Exiting...');
		process.exit(0);
	}
	if(trigger_fileload)
	{
		ourlog('... Your use of the "-l" option is meaningless in this case. Exiting...');
		process.exit(0);
	}
	spawn_talker();
	no_cmdline = true;
	am_relay = true;
} else
{
	write_pid();
	networker.init();
	create_listener(ourlog);
}


if(no_cmdline)
{
	if(!am_relay)
		to_syslog = true;
	opensyslog();
	networker.logger(ourlog);
	process.on('uncaughtException', function (err) {
		ourlog(`uncaughtException: ${err}`);
		let msg = err.message;
		Network.clientMessage({cmd:'uncaughtException',d:msg});
	});
} else
	spawn_cmdline(); // spawn = commandline

if(trigger_fileload)
	networker.load_config();

function spawn_cmdline()
{
	rl = require('readline').createInterface({
		input: process.stdin,
		output: process.stdout
	});

	var ctx = {};
	ctx.logger = ourlog;
	ctx.master = true;
	ctx.logging = networker.logging(); // grab copy of current log settings
	networker.add_ctx(ctx);

	pre_execute.forEach(function(line) {userCommand(line, ctx);});

	rl.setPrompt('');
	rl.on('line', function(line) {userCommand(line, ctx);});
	rl.on('close', function () {rl = false;doquit(0);});
	rl.prompt();
}

function spawn_talker() // we want to talk to the listener
{
	brief_log = true;
	ourlog('Attempting to connect to running process...');
	var client = net.connect({path: sockname});
	client.on('data', function(data) {ourlog(data.toString().trim());});
	client.on('close', function() {ourlog('Closed');rl.close();});
	client.on('error', function() {ourlog('Error');});
	client.on('connect', function() {
		ourlog('Connected');
		pre_execute.forEach(function(line) {client.write(line + '\n');});
		rl = require('readline').createInterface({
			input: process.stdin,
			output: process.stdout
		});

		rl.setPrompt('');
		rl.on('line', function(line) {
			client.write(line + '\n');
		});
		rl.on('close', function () {rl = false;process.exit(0);});
		rl.prompt();
	});
}

function showcommands(filter, ctx)
{
	var arr = networker.confighelp();
	var confighelp = '';
	var spaces = '                      ';
	Object.keys(arr).forEach(function(key) {
		confighelp += '\n        ' + key + spaces.slice(-16+key.length) + '= ' + arr[key];
	});

	function helpline(line)
	{
		if(!filter || filter == line.substr(0,filter.length))
			ctx.logger(line);
	}

	helpline('at<whatever>            = issue AT command (example: at&v)');
	helpline('&v                      = request cellular modem info');
	helpline('bl|unbl <tech>          = blacklist or unblacklist <tech>');
	helpline('csq                     = request cellular signal quality');
	helpline('connect <technology>    = Connect. (!!! Temporary, only wifi, this is going away !!!)');
	helpline('deroute                 = Remove any existing route');
	helpline('dhcp <technology>       = Send dhcp request over <technology>');
	helpline('file load|save|view|diff= Manage config file');
	helpline('h|history [<#lines|all>]= Show log history lines');
	helpline('help                    = show this help text');
	helpline('info|?                  = Network info technologies[], route, etc.');
	helpline('nd                      = Do ntpdate command');
	helpline('netmon                  = Perform a netmon message transaction');
	helpline('p|ping [<hostname>]     = Send single ping. Defaults to ' + pingtarget);
	helpline('pr                      = Print network routing table');
	helpline('r|route [<technology>]  = Route to internet over <technology> or show route');
	helpline('scan                    = trigger wifi network scan');
	helpline('sp|+sp|-sp              = Shorthand for set log=+sp and log=-sp');
	helpline('sr                      = Show most recent scan results');
	helpline('set [var=val] ...       = Set or show networker variables' + confighelp);
	helpline('toggle <technology>     = set technology 0 then 1');
	helpline('verify <tech>           = Use ping -I <interface> to verify a technology');
	helpline('version                 = show ' + networker.myname + ' version');
	helpline('x                       = exit');
	helpline('z                       = generic test hook');
	helpline('wifissid                = set the wifi ssid of high priority in the wifi list');
	helpline('wifipsk                 = set the wifi psk of high priority in the wifi list');
}
function ssend(msg, ctx)
{
	if(networker.set({log:'+sp'}, ctx))
	{
//		ctx.logger('Turning on sp log to receive response(s). Turn back off with "set log=-sp"');
		networker.at_finished(function () {
			networker.set({log:'-sp'}, ctx);
		});
	}
	networker.send(msg);
}

function objectCommand(obj, ctx) {
	switch(obj.cmd) {
	case 'aging_test':
		mylog('starting the Aging test');
		startAgingTest = true;
		break;
	case 'wifi_scan':
		mylog('Running the wifi scan');
		networker.scan(function (res) {
			ctx.logger(networker.maketree(res));
			ctx.send({cmd:'wifi_scan',d:res, source:obj.source, obj:obj.o});
		});
		break;
	case 'test':
		mylog('objectCommand test');
		ctx.send({cmd:'nop'});
		break;
	case 'settings':
		ctx.send({cmd:'settings',d:networker.settings(ctx)});
		break;
	case 'info':
		let networkType = networker.info().currentroute.split(',');
		if(networkType[0] === 'wifi'){
			updateCurrentWifiSsid();
		}
		ctx.send({cmd:'info',d:networker.info()});
		break;
	case 'set':
		if(obj.d) {
			var diffs = {};
			var changed = networker.set(obj.d, ctx, diffs);
			if(changed && obj.save) {
				mylog('objectCommand set with diffs to be saved:');
				mylog(networker.maketree(diffs));
				networker.update_config(ctx, diffs);
			}
		}
		break;
	case 'nop': // do nothing upon receipt
		break;
	case 'reboot':
		child_process.exec('sync && echo b > /proc/sysrq-trigger');
		break;
	case 'scanResults':
		ctx.send({cmd:'scanResults', d:networker.scan_results()});
		break;
	case 'save':
		if(networker.diff_config() != 'No differences')
			networker.save_config(ctx);
		break;
	case 'shutdown':
		child_process.exec('shutdown -h now');
		break;
	case 'command':
		if(obj.d)
			userCommand(obj.d, ctx);
		break;
	case 'nd':
		quickcmd('ntpdate -b 0.debian.pool.ntp.org 1.debian.pool.ntp.org 2.debian.pool.ntp.org 3.debian.pool.ntp.org', ctx);
		break;
	default:
		mylog('objectCommand unknown ' + obj.cmd);
		break;
	}
}
// if we are passed an array, assume it's already an array of arguments
// otherwise split the string into arguments separated by whitespace
function userCommand(answer, ctx)
{
	var argv = [];
	if(answer instanceof Array)
		argv = answer;
	else
	{
		answer.split(' ').forEach(function (v) {
			if(v != '')
				argv.push(v);
		});
	}
	if(argv.length == 0)
		argv.push('');

	var argc = argv.length;
	var command = argv[0];
	var int1 = false;
	var par1 = false;
	if(argv[1])
	{
		par1 = argv[1];
		int1 = parseInt(par1);
	}
	switch(command)
	{
	case 'z':
		break;
	case 'c01': // sim7500a disconnect
		ssend('AT$QCRMCALL=0,1', ctx);
		break;
	case 'c11': // sim7500a connect
		ssend('AT$QCRMCALL=1,1', ctx);
		break;
	case 'c?':
		ssend('AT$QCRMCALL?', ctx);
		break;
	case 'c1': // sim7500a TING config...
		ssend('AT+CGDCONT=1,"IP","wholesale"', ctx);
		break;
	case 'c2': // sim7500a query string from SIM7500_SIM7600 Linux NDIS User Guide_V2.00.pdf
		ssend('AT+CREG?', ctx);
		break;
	case 'c3': // sim7500a query string from SIM7500_SIM7600 Linux NDIS User Guide_V2.00.pdf
		ssend('AT+CGREG?', ctx);
		break;
	case 'c4': // sim7500a query string from SIM7500_SIM7600 Linux NDIS User Guide_V2.00.pdf
		ssend('AT+CPSI?', ctx);
		break;
	case 'csq':
		ssend('AT+CSQ', ctx);
		break;
	case '&v':
		ssend('AT&V', ctx);
		break;
	case 'dhcp':
		if(!par1)
			showcommands('dhcp ', ctx);
		else
			networker.dhcp(par1, function(err, res) {
				if(err) ctx.logger('dhcp err: ' + err);
				else
				{
					ctx.logger('dhcp ' + par1 + ':');
					ctx.logger(networker.maketree(res));
				}
			});
		break;
	default:
		if(command.indexOf('at')==0 || command.indexOf('AT')==0)
		{
			ctx.logger('AT command ' + command);
			ssend(answer.trim() + '', ctx);
			break;
		}
	case 'help':
	case '':
		showcommands(false, ctx);
		break;
	case 'quit':
	case 'x':
		if(ctx && !ctx.master)
		{
			disconnect_client(ctx);
			break;
		}
		networker.shutdown(function() {
			rl.close();
			rl = false;
		});
		break;
	case 'version':
	case 'v':
		ctx.logger('networker.js version ' + networker.version());
		break;
	case '?':
	case 'info':
		ctx.logger(networker.maketree(networker.info(par1)));
		break;
	case 'scan':
		networker.scan(function (res) {ctx.logger(networker.maketree(res));});
		break;
	case 'sr':
		var sr = networker.scan_results();
		if(sr.length>0) ctx.logger(networker.maketree(sr).trim());
		else ctx.logger('Nothing');
		break;
	case '+sp':
	case 'sp':
	case '-sp':
		networker.set({log:(command=='-sp' ? '-' : '+') + 'sp'}, ctx);
		break;
	case 'set':
	case 'config':
		var o = {};
		var some = false;
		for(var i=1;i<argc;++i)
		{
			var e = argv[i].split('=');
			if(e.length == 2)
			{
				o[e[0]] = e[1].replace(/"/g, ''); // no double quotes allowed
				some = true;
			}
			else ctx.logger('Use something=value');
		}
//		ctx.logger(networker.maketree(o));
		if(some) networker.set(o, ctx);
		else ctx.logger(networker.maketree(networker.settings(ctx)));
		break;
	case 'showconfig':
	case 'settings':
		ctx.logger(networker.maketree(networker.settings(ctx)));
		break;
	case 'connect':
		if(!par1)
			showcommands('connect ', ctx);
		else
			networker.connect(par1);
		break;
	case 'pr':
		quickcmd('route -n', ctx);
		break;
	case 'p':
	case 'ping':
		quickcmd('ping -n -c 1 ' + (par1 || pingtarget) + '| grep -v -e statistic -e transmitted -e mdev -e PING -e "^$"', ctx);
		break;
	case 'nd':
		quickcmd('ntpdate -b 0.debian.pool.ntp.org 1.debian.pool.ntp.org 2.debian.pool.ntp.org 3.debian.pool.ntp.org', ctx);
		break;
	case 'r':
	case 'route':
		if(!par1)
			ctx.logger(networker.route());
		else
			networker.route(par1);
		break;
	case 'deroute':
		networker.deroute();
		break;
	case 'file':
		if(par1=='load' || par1=='l') networker.load_config(ctx);
		else if(par1=='save' || par1=='s') networker.save_config(ctx);
		else if(par1=='view' || par1=='v' || par1=='show') ctx.logger(networker.maketree(networker.view_config(ctx)));
		else if(par1=='diff' || par1=='d') ctx.logger(networker.diff_config());
		else showcommands('file ', ctx);
		break;
	case 'blacklist':
	case 'bl':
		networker.blacklist(par1);
		break;
	case 'unblacklist':
	case 'unbl':
		networker.unblacklist(par1);
		break;
	case 'verify':
		networker.verify(par1);
		break;
	case 'sdf':
		quickcmd('qmicli -d /dev/cdc-wdm0 --wda-set-data-format=802-3', ctx);
		break;
	case 'gdf':
		quickcmd('qmicli -d /dev/cdc-wdm0 --wda-get-data-format', ctx);
		break;
	case 'qmi':
		if(par1=='start' || par1=='stop' || par1=='status')
			networker.qminet(par1, ctx);
		else ctx.logger('Must specify start|stop|status');
//quickcmd('/usr/bin/qmi-network /dev/cdc-wdm0 ' + par1, ctx);
		break;
	case 'h':
	case 'history':
		networker.history(par1, ctx);
		break;
	case 'ha':
		networker.history('all', ctx);
		break;
	case 'f':
	case 'flags':
		ctx.logger('flags:');
		ctx.logger(networker.maketree(networker.get_all_flags()));
		break;
	case 'toggle':
		if(!par1) {ctx.logger('Must specify technology to toggle');break;}
		if(!networker.toggle(par1)) ctx.logger('Error trying to toggle technology ' + par1);
		break;
	case 'maxWifiBackupCreds':
		if(!par1) {ctx.logger('Must specify the maximum number of wifi creds that can be stored');break;}
		changeMaxWifiBackup(par1);
		break;
	case 'netmon':
		networker.netmon(par1);
		break;
	case 'wifissid':
		Network.config.wifi_list[0].wifi_ssid = par1;
		break;
	case 'wifipsk':
		Network.config.wifi_list[0].wifi_psk = par1;
		break;
	}
}
