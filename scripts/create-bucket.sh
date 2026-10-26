#!/usr/bin/env bash
# Cria um bucket S3 privado para as notas, com versionamento (toda versão salva e
# toda nota apagada continuam recuperáveis) e criptografia no servidor.
#
# Uso: scripts/create-bucket.sh <nome-do-bucket> [regiao] [perfil-aws]
# Ex.:  scripts/create-bucket.sh lucas-docs-notas sa-east-1 default
set -euo pipefail

BUCKET="${1:?uso: $0 <nome-do-bucket> [regiao] [perfil-aws]}"
REGION="${2:-us-east-1}"
PROFILE="${3:-default}"

aws_() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

echo "Criando s3://$BUCKET em $REGION (perfil $PROFILE)…"
if [ "$REGION" = "us-east-1" ]; then
  aws_ s3api create-bucket --bucket "$BUCKET"
else
  aws_ s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$REGION"
fi

echo "Bloqueando todo acesso público…"
aws_ s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "Ativando versionamento…"
aws_ s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled

echo "Ativando criptografia SSE-S3…"
aws_ s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

echo "Pronto. Use o bucket \"$BUCKET\" e a região \"$REGION\" nas configurações do app."
