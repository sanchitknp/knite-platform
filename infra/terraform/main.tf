provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Use the account's default VPC + subnets. Keeps the stack minimal for a pilot.
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# Latest Amazon Linux 2023 AMI for x86_64 (matches t3.micro).
data "aws_ssm_parameter" "al2023_x86" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# Detect caller's public IP to auto-whitelist SSH.
data "http" "myip" {
  url = "https://checkip.amazonaws.com/"
}

locals {
  my_ip    = "${chomp(data.http.myip.response_body)}/32"
  ssh_cidr = var.allowed_ssh_cidr != "" ? var.allowed_ssh_cidr : local.my_ip

  name_prefix = "${var.project}-${var.environment}"
}
