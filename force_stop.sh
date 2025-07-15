#!/usr/bin/env bash

dir_A="/home/araray/.config/llmchat/"
dir_B="/av/logs/llmchat"
dir_out="/av/outputs"
fout="${dir_out}/llmchat_logs_$(date +'%s').txt"

echo "Running llmchat_web processes:"
ps -Fewww | grep -Ei "llmchat_web" | grep -v grep

echo "  - Forcing killing these processes"
kill -9 $(ps -Fewww | grep -Ei "llmchat_web" | grep -v grep | awk '{print $2}' | sort -h)

echo "  - Collecting logs"
{
    for f in $(find ${dir_A} -type f); do
        echo "--- File: '$f' ---"
        cat $f
        echo "--- EOF: '$f' ---"
    done

    for f in $(find ${dir_B} -type f); do
        echo "--- File: '$f' ---"
        cat $f
        echo "--- EOF: '$f' ---"
    done
} | tee -a ${fout}

find ${dir_A} -type f -exec rm -f {} \;
find ${dir_B} -type f -exec rm -f {} \;

echo "  - Logs saved to '${fout}'"
