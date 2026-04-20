variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "aws_profile" {
  description = "AWS CLI profile — MUST be 'knite' per project policy"
  type        = string
  default     = "knite"
}

variable "project" {
  description = "Project tag prefix"
  type        = string
  default     = "knite"
}

variable "environment" {
  description = "Environment tag"
  type        = string
  default     = "pilot"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.micro"
}

variable "volume_size_gb" {
  description = "Root EBS volume size in GiB"
  type        = number
  default     = 30
}

variable "key_name" {
  description = "EC2 key pair name"
  type        = string
  default     = "knite-deploy"
}

variable "allowed_ssh_cidr" {
  description = "CIDR allowed to SSH. Leave empty to auto-detect caller's public IP."
  type        = string
  default     = ""
}
