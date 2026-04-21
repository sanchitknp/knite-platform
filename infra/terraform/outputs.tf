output "instance_id" {
  description = "EC2 instance ID"
  value       = aws_instance.knite.id
}

output "public_ip" {
  description = "Elastic IP"
  value       = aws_eip.knite.public_ip
}

output "public_dns" {
  description = "EC2 public DNS (Amazon — does NOT work with Let's Encrypt)"
  value       = aws_instance.knite.public_dns
}

output "nip_io_host" {
  description = "nip.io hostname that resolves to the Elastic IP"
  value       = "${replace(aws_eip.knite.public_ip, ".", "-")}.nip.io"
}

output "http_url" {
  description = "Bare HTTP URL on port 80 (Caddy reverse proxy)"
  value       = "http://${aws_eip.knite.public_ip}"
}

output "http_url_3000" {
  description = "Direct backend URL on port 3000"
  value       = "http://${aws_eip.knite.public_ip}:3000"
}

output "https_url" {
  description = "HTTPS URL via nip.io (real Let's Encrypt cert, WhatsApp-compatible)"
  value       = "https://${replace(aws_eip.knite.public_ip, ".", "-")}.nip.io"
}

output "ssh_command" {
  description = "Ready-to-paste SSH command"
  value       = "ssh -i ~/.ssh/${var.key_name}.pem ec2-user@${aws_eip.knite.public_ip}"
}

output "key_path" {
  description = "Local path to the private SSH key"
  value       = pathexpand("~/.ssh/${var.key_name}.pem")
}

# ── RDS outputs ────────────────────────────────────────────────────────────
output "rds_endpoint" {
  description = "RDS writer endpoint (host only, no port)"
  value       = aws_db_instance.knite.address
}

output "rds_port" {
  description = "RDS port"
  value       = aws_db_instance.knite.port
}

output "rds_db_name" {
  description = "RDS database name"
  value       = aws_db_instance.knite.db_name
}

output "rds_username" {
  description = "RDS master username"
  value       = aws_db_instance.knite.username
}

output "rds_password" {
  description = "RDS master password (sensitive)"
  value       = random_password.db.result
  sensitive   = true
}

output "database_url" {
  description = "Ready-to-paste DATABASE_URL for the backend"
  value       = "postgresql://${aws_db_instance.knite.username}:${random_password.db.result}@${aws_db_instance.knite.address}:${aws_db_instance.knite.port}/${aws_db_instance.knite.db_name}"
  sensitive   = true
}
