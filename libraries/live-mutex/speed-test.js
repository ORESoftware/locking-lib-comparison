



const path = require('path');
const async = require('async');

const lmUtils = require('live-mutex/utils');
const Client = require('live-mutex/client');



/// NOTE: this should run in about 450 ms in series on Ubuntu 16.04; if you change it from async.eachSeries to async.each,
/// then it will run slightly slower, at about 550 ms

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

const a = Array.apply(null, {length: 300});
console.log(' => locking/unlocking ' + a.length + ' times, in ' + msg);

lmUtils.conditionallyLaunchSocketServer({})
    .then(function (data) {


        const client = new Client();

        const start = Date.now();

        fn(a, function (val, cb) {

            client.lock('foo', function (err, unlock) {
                if (err) {
                    cb(err);
                }
                else {
                    unlock(cb);
                }
            });

        }, function complete(err) {

            if (err) {
                throw err;
            }

            console.log(' => Time required for live-mutex => ', Date.now() - start, 'ms');
            process.exit(0);
        });


    });


