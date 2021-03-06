#!/usr/bin/env bash


LIBS_DIR=$(cd $(dirname "$0")/libraries && pwd)

echo "libs dir => $LIBS_DIR"


# SERIAL LOCK/UNLOCK CYCLES
for d in "$LIBS_DIR"/* ; do
     echo " "
     echo "running speed-test in the following dir => $d"
     echo " "
     cd "$d" && node ./speed-test.js;
done


# PARALLEL LOCK/UNLOCK CYCLES
for d in "$LIBS_DIR"/* ; do
     echo " "
     echo "running speed-test in the following dir => $d"
     echo " "
     cd "$d" && node ./speed-test.js parallel;
done