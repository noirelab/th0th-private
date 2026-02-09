#!/bin/bash
# Setup script for Ollama in WSL environment

set -e

echo "🔍 Detectando ambiente..."

# Get Windows host IP
WINDOWS_IP=$(cat /etc/resolv.conf | grep nameserver | awk '{print $2}')
echo "✓ IP do host Windows: $WINDOWS_IP"

# Test connection to Windows Ollama
echo ""
echo "🔗 Testando conexão com Ollama no Windows..."
if curl -s --connect-timeout 3 "http://$WINDOWS_IP:11434/api/tags" > /dev/null 2>&1; then
    echo "✓ Conexão com Ollama estabelecida!"
    OLLAMA_URL="http://$WINDOWS_IP:11434"
else
    echo "❌ Não foi possível conectar ao Ollama no Windows"
    echo ""
    echo "Opções:"
    echo "1. Configurar Ollama no Windows para aceitar conexões externas"
    echo "   Ver: OLLAMA_WSL_SETUP.md"
    echo ""
    echo "2. Instalar Ollama localmente no WSL"
    read -p "Deseja instalar Ollama no WSL? (s/N): " choice
    
    if [[ "$choice" == "s" || "$choice" == "S" ]]; then
        echo ""
        echo "📦 Instalando Ollama no WSL..."
        curl https://ollama.ai/install.sh | sh
        
        echo ""
        echo "🚀 Iniciando Ollama..."
        ollama serve &
        OLLAMA_PID=$!
        sleep 5
        
        echo ""
        echo "📥 Baixando modelo bge-m3..."
        ollama pull bge-m3
        
        OLLAMA_URL="http://localhost:11434"
        echo "✓ Ollama instalado e configurado!"
    else
        echo ""
        echo "⚠️  Ollama não está acessível. Configure manualmente."
        echo "Ver: OLLAMA_WSL_SETUP.md"
        exit 1
    fi
fi

# Update .env file
echo ""
echo "📝 Atualizando arquivo .env..."
ENV_FILE="$(dirname "$0")/.env"

if [ -f "$ENV_FILE" ]; then
    # Update existing OLLAMA_BASE_URL
    if grep -q "^OLLAMA_BASE_URL=" "$ENV_FILE"; then
        sed -i "s|^OLLAMA_BASE_URL=.*|OLLAMA_BASE_URL=$OLLAMA_URL|" "$ENV_FILE"
    else
        echo "OLLAMA_BASE_URL=$OLLAMA_URL" >> "$ENV_FILE"
    fi
else
    cat > "$ENV_FILE" << EOF
# Ollama Configuration
OLLAMA_BASE_URL=$OLLAMA_URL
OLLAMA_EMBEDDING_MODEL=bge-m3

# API Configuration
PORT=3333
NODE_ENV=development
EOF
fi

echo "✓ Arquivo .env atualizado"
echo ""

# Test embedding
echo "🧪 Testando embedding..."
if curl -s "$OLLAMA_URL/api/embeddings" \
    -d '{
        "model": "bge-m3",
        "prompt": "test"
    }' > /dev/null 2>&1; then
    echo "✓ Embeddings funcionando!"
else
    echo "⚠️  Embeddings não testados. Certifique-se de que o modelo bge-m3 está instalado:"
    echo "   ollama pull bge-m3"
fi

echo ""
echo "✅ Configuração concluída!"
echo ""
echo "Para iniciar o servidor:"
echo "  cd apps/tools-api"
echo "  bun run start"
