#!/bin/bash
set -e

# ========================================
# th0th - Local-First Setup Script
# ========================================
# Configura o th0th para funcionar 100% offline
# sem dependencia de servicos externos.
#
# Uso: ./scripts/setup-local-first.sh
# ========================================

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  th0th - Local-First Setup${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""

# ---- Step 1: Check Ollama ----
echo -e "${BOLD}[1/5] Checking Ollama...${NC}"

OLLAMA_URL="${OLLAMA_HOST:-http://localhost:11434}"
OLLAMA_HAS_CLI=false
OLLAMA_API_REACHABLE=false

# Check if Ollama CLI is available
if command -v ollama &> /dev/null; then
    OLLAMA_HAS_CLI=true
    echo -e "  ${GREEN}✓${NC} Ollama CLI is installed"
fi

# Check if Ollama API is reachable (covers WSL -> Windows host, remote, etc.)
if curl -s "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
    OLLAMA_API_REACHABLE=true
    OLLAMA_VERSION=$(curl -s "${OLLAMA_URL}/api/version" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','unknown'))" 2>/dev/null || echo "unknown")
    echo -e "  ${GREEN}✓${NC} Ollama API reachable at ${OLLAMA_URL} (v${OLLAMA_VERSION})"
fi

if [ "$OLLAMA_HAS_CLI" = false ] && [ "$OLLAMA_API_REACHABLE" = false ]; then
    # Neither CLI nor API available - try to install
    echo -e "  ${YELLOW}⚠${NC} Ollama not found (no CLI, no API at ${OLLAMA_URL}). Installing..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        curl -fsSL https://ollama.com/install.sh | sh
        OLLAMA_HAS_CLI=true
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "  ${YELLOW}⚠${NC} On macOS, install Ollama from: https://ollama.com/download"
        echo -e "  ${YELLOW}⚠${NC} Then re-run this script."
        exit 1
    else
        echo -e "  ${RED}✗${NC} Unsupported OS. Install Ollama manually: https://ollama.com"
        exit 1
    fi
elif [ "$OLLAMA_HAS_CLI" = false ] && [ "$OLLAMA_API_REACHABLE" = true ]; then
    # API reachable but no CLI (e.g. WSL with Ollama on Windows host)
    echo -e "  ${GREEN}✓${NC} Using remote Ollama API (no local CLI needed)"
fi

# If API is not reachable yet, try to start it
if [ "$OLLAMA_API_REACHABLE" = false ]; then
    if [ "$OLLAMA_HAS_CLI" = true ]; then
        echo -e "  ${YELLOW}⚠${NC} Ollama API not responding. Starting..."
        nohup ollama serve > /dev/null 2>&1 &
        sleep 2

        if curl -s "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
            OLLAMA_API_REACHABLE=true
            echo -e "  ${GREEN}✓${NC} Ollama started successfully"
        else
            echo -e "  ${RED}✗${NC} Failed to start Ollama. Please start it manually: ollama serve"
            exit 1
        fi
    else
        echo -e "  ${RED}✗${NC} Ollama API not reachable at ${OLLAMA_URL}"
        echo -e "      Set OLLAMA_HOST to point to your Ollama instance."
        exit 1
    fi
fi

# ---- Step 2: Pull embedding models ----
echo ""
echo -e "${BOLD}[2/5] Pulling embedding models...${NC}"

EMBEDDING_MODEL="${OLLAMA_EMBEDDING_MODEL:-nomic-embed-text:latest}"

# Check if model is already available via API
MODEL_EXISTS=$(curl -s "${OLLAMA_URL}/api/tags" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
models = [m['name'] for m in data.get('models', [])]
search = '${EMBEDDING_MODEL%%:*}'
print('yes' if any(search in m for m in models) else 'no')
" 2>/dev/null || echo "no")

if [ "$MODEL_EXISTS" = "yes" ]; then
    echo -e "  ${GREEN}✓${NC} Model ${EMBEDDING_MODEL} already available"
else
    echo -e "  Pulling ${EMBEDDING_MODEL}..."
    if [ "$OLLAMA_HAS_CLI" = true ]; then
        ollama pull "$EMBEDDING_MODEL"
    else
        # Pull via API (works for remote/WSL scenarios)
        curl -s "${OLLAMA_URL}/api/pull" -d "{\"name\": \"${EMBEDDING_MODEL}\"}" | while IFS= read -r line; do
            STATUS=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
            if [ -n "$STATUS" ]; then
                printf "\r  %s" "$STATUS"
            fi
        done
        echo ""
    fi
    echo -e "  ${GREEN}✓${NC} Model ${EMBEDDING_MODEL} pulled"
fi

# ---- Step 3: Create data directories ----
echo ""
echo -e "${BOLD}[3/5] Creating data directories...${NC}"

DATA_DIR="${HOME}/.rlm"
mkdir -p "$DATA_DIR"
echo -e "  ${GREEN}✓${NC} Data directory: ${DATA_DIR}"

# ---- Step 4: Configure environment ----
echo ""
echo -e "${BOLD}[4/5] Configuring environment...${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ ! -f "${PROJECT_DIR}/.env" ]; then
    cp "${PROJECT_DIR}/.env.local-first" "${PROJECT_DIR}/.env"
    echo -e "  ${GREEN}✓${NC} Created .env from .env.local-first"
else
    echo -e "  ${YELLOW}⚠${NC} .env already exists. To use local-first config:"
    echo -e "      cp .env.local-first .env"
fi

# ---- Step 5: Verify setup ----
echo ""
echo -e "${BOLD}[5/5] Verifying setup...${NC}"

# Check Ollama health
if curl -s "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
    MODELS=$(curl -s "${OLLAMA_URL}/api/tags" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len(data.get('models',[])))" 2>/dev/null || echo "?")
    echo -e "  ${GREEN}✓${NC} Ollama: healthy at ${OLLAMA_URL} (${MODELS} models available)"
else
    echo -e "  ${RED}✗${NC} Ollama: not responding at ${OLLAMA_URL}"
fi

# Check data directory
if [ -d "$DATA_DIR" ] && [ -w "$DATA_DIR" ]; then
    DB_COUNT=$(find "$DATA_DIR" -name "*.db" 2>/dev/null | wc -l)
    echo -e "  ${GREEN}✓${NC} Data directory: writable (${DB_COUNT} databases)"
else
    echo -e "  ${RED}✗${NC} Data directory: not writable"
fi

# Check .env
if [ -f "${PROJECT_DIR}/.env" ]; then
    if grep -q "RLM_LLM_ENABLED=false" "${PROJECT_DIR}/.env" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Config: local-first mode"
    else
        echo -e "  ${YELLOW}⚠${NC} Config: may have external dependencies"
    fi
else
    echo -e "  ${RED}✗${NC} Config: .env not found"
fi

# ---- Summary ----
echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  Setup Complete${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""
echo -e "  ${GREEN}Local-First Configuration:${NC}"
echo -e "    Embeddings: Ollama (${EMBEDDING_MODEL})"
echo -e "    Compression: Rule-based (no LLM)"
echo -e "    Cache: SQLite (local)"
echo -e "    Vector DB: SQLite (local)"
echo -e "    External APIs: None"
echo -e "    Cost: \$0"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "    1. bun install"
echo -e "    2. bun run build"
echo -e "    3. bun run start:api"
echo -e "    4. curl http://localhost:3333/health"
echo -e "    5. curl http://localhost:3333/api/v1/system/health/local"
echo ""
