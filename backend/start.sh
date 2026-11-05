#!/bin/bash
postgrest &
PGRST_PID=$!

# Wait up to 60s for PostgREST, because the backend exits if it can't reach it at startup
for i in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:3000/').then(()=>process.exit(0)).catch(()=>process.exit(1))"; then
    echo "PostgREST is up"
    break
  fi
  sleep 1
done

node src/server.js &
NODE_PID=$!

trap 'kill $PGRST_PID $NODE_PID 2>/dev/null' TERM INT
wait -n
echo "A process exited, stopping container"
kill $PGRST_PID $NODE_PID 2>/dev/null
exit 1
