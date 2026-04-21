# -----------------------------------------------------------------------------
# rds.tf — minimal RDS Postgres for the Knite pilot.
#
# - db.t3.micro (free-tier eligible), 20 GiB gp3, single-AZ, Postgres 15.
# - Lives in the default VPC, same subnets as EC2.
# - Publicly accessible = false. Only the EC2 security group can reach 5432.
# - No final snapshot, 0-day backup retention — throwaway pilot DB.
# -----------------------------------------------------------------------------

resource "random_password" "db" {
  length  = 24
  special = false # keep URL-safe; pgpass / connection strings stay simple
}

resource "aws_db_subnet_group" "knite" {
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = data.aws_subnets.default.ids

  tags = {
    Name = "${local.name_prefix}-db-subnets"
  }
}

resource "aws_security_group" "db" {
  name        = "${local.name_prefix}-db-sg"
  description = "Knite RDS: allow 5432 from the EC2 security group only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Postgres from app SG"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.knite.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-db-sg"
  }
}

resource "aws_db_instance" "knite" {
  identifier     = "${local.name_prefix}-db"
  engine         = "postgres"
  engine_version = "15"
  instance_class = "db.t3.micro"

  allocated_storage     = 20
  max_allocated_storage = 0 # disable autoscaling for pilot
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "knite"
  username = "knite"
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.knite.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = 0
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true

  # AL2023 / pg 15 compatible parameter group is the default; no custom tweaks.
  performance_insights_enabled = false

  tags = {
    Name = "${local.name_prefix}-db"
  }
}
