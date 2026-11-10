#!/bin/bash

# Simulates JWT Pizza traffic so every Grafana metric has data.
# Requires jq and the users, menu, and franchise from generateData.sh.

# Check if host is provided as a command line argument
if [ -z "$1" ]; then
  echo "Usage: $0 <host>"
  echo "Example: $0 http://localhost:3000"
  exit 1
fi
host=$1

# Stop every background loop when the script exits (CTRL-C)
cleanup() {
  echo "Terminating background processes..."
  kill $(jobs -p) 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

login() {
  curl -s -X PUT "$host/api/auth" -d "{\"email\":\"$1\", \"password\":\"$2\"}" -H 'Content-Type: application/json' | jq -r '.token'
}

logout() {
  curl -s -o /dev/null -X DELETE "$host/api/auth" -H "Authorization: Bearer $1"
}

# order <token> <pizza count>
order() {
  items='{ "menuId": 1, "description": "Veggie", "price": 0.0038 }'
  for ((i = 1; i < $2; i++)); do
    items+=', { "menuId": 1, "description": "Veggie", "price": 0.0038 }'
  done
  curl -s -o /dev/null -w '%{http_code}' -X POST "$host/api/order" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $1" \
    -d "{\"franchiseId\": 1, \"storeId\": 1, \"items\": [$items]}"
}

# Browse the menu every three seconds
while true; do
  echo "Requesting menu... $(curl -s -o /dev/null -w '%{http_code}' "$host/api/order/menu")"
  sleep 3
done &

# Fail a login every 25 seconds
while true; do
  status=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$host/api/auth" -d '{"email":"unknown@jwt.com", "password":"bad"}' -H 'Content-Type: application/json')
  echo "Logging in with invalid credentials... $status"
  sleep 25
done &

# Franchisee session that stays logged in for two minutes
while true; do
  token=$(login f@jwt.com franchisee)
  echo "Login franchisee... $([ "$token" != "null" ] && echo true || echo false)"
  sleep 110
  logout "$token"
  echo "Logging out franchisee..."
  sleep 10
done &

# Diner buys one to three pizzas about once a minute
while true; do
  token=$(login d@jwt.com diner)
  echo "Login diner... $([ "$token" != "null" ] && echo true || echo false)"
  echo "Bought a pizza... $(order "$token" $((RANDOM % 3 + 1)))"
  sleep 20
  logout "$token"
  echo "Logging out diner..."
  sleep 30
done &

# Hungry diner orders too many pizzas every five minutes so the factory fails
while true; do
  token=$(login d@jwt.com diner)
  echo "Login hungry diner... $([ "$token" != "null" ] && echo true || echo false)"
  echo "Bought too many pizzas... $(order "$token" 22)"
  sleep 5
  logout "$token"
  echo "Logging out hungry diner..."
  sleep 295
done &

wait
