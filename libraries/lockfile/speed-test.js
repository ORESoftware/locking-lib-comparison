const path = require('path');
const async = require('async');
const lf = require('lockfile');
const fs = require('fs');

const a = Array.apply(null, {length: 300});
const file = path.resolve(process.env.HOME + '/speed-test.lock');

try{
    fs.unlinkSync(file);
}
catch(e){}


/// NOTE: this should run in about 30ms on a SSD Ubuntu 16.04, that is fast, because we are locking/unlocking 300 locks
/// *HOWEVER* if we change async.eachSeries to async.each, lockfile will barf immediately, and I can't get lockfile
/// to not barf, using any of the options {} available to lockfile#lock.


const parallel = process.argv[2] === 'parallel';

var fn, msg;

if(parallel){
    msg = 'parallel';
    fn = async.each;
}
else{
    msg = 'series';
    fn = async.eachSeries;
}


const start = Date.now();
console.log(' => locking/unlocking ' + a.length + ' times, in ' + msg);

fn(a, function (val, cb) {

    // ignore val, not using it

    lf.lock(file, function (err) {
        if (err) {
            cb(err);
        }
        else {
            lf.unlock(file, cb);
        }
    });

}, function complete(err) {

    if (err) {
        throw err;
    }

    console.log(' => Time required for lockfile => ', Date.now() - start, 'ms');
    process.exit(0);

});
