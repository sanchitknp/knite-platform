resource "aws_instance" "knite" {
  ami                         = data.aws_ssm_parameter.al2023_x86.value
  instance_type               = var.instance_type
  key_name                    = aws_key_pair.knite.key_name
  vpc_security_group_ids      = [aws_security_group.knite.id]
  subnet_id                   = data.aws_subnets.default.ids[0]
  associate_public_ip_address = true
  user_data                   = file("${path.module}/user_data.sh")

  metadata_options {
    http_tokens   = "required" # IMDSv2 only
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_size           = var.volume_size_gb
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  tags = {
    Name = local.name_prefix
  }

  lifecycle {
    ignore_changes = [ami] # Don't rebuild the instance just because SSM parameter rolled
  }
}

resource "aws_eip" "knite" {
  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-eip"
  }
}

resource "aws_eip_association" "knite" {
  instance_id   = aws_instance.knite.id
  allocation_id = aws_eip.knite.id
}
