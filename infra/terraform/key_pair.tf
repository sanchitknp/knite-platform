# Generate a fresh RSA key pair in-cluster, register as an EC2 key pair,
# and drop the private key at ~/.ssh/<key_name>.pem with 0400 permissions.

resource "tls_private_key" "knite" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "knite" {
  key_name   = var.key_name
  public_key = tls_private_key.knite.public_key_openssh
}

resource "local_sensitive_file" "private_key" {
  content         = tls_private_key.knite.private_key_pem
  filename        = pathexpand("~/.ssh/${var.key_name}.pem")
  file_permission = "0400"
}
