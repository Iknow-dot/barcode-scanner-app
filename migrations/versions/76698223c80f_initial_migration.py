"""Initial migration

Revision ID: 76698223c80f
Revises: 
Create Date: 2024-09-03 17:47:20.711408

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '76698223c80f'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('web_service_url', sa.String(length=255), nullable=False))
        batch_op.alter_column('name',
               existing_type=sa.VARCHAR(length=255),
               type_=sa.String(length=100),
               existing_nullable=False)
        batch_op.alter_column('identification_code',
               existing_type=sa.VARCHAR(length=100),
               type_=sa.String(length=50),
               existing_nullable=False)
        batch_op.create_unique_constraint(None, ['identification_code'])
        batch_op.drop_column('web_service_address')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('password_hash', sa.String(length=255), nullable=False))  # Updated length
        batch_op.alter_column('username',
               existing_type=sa.VARCHAR(length=255),
               type_=sa.String(length=100),
               existing_nullable=False)
        batch_op.alter_column('role_id',
               existing_type=sa.UUID(),
               nullable=False)
        batch_op.alter_column('ip_address',
               existing_type=sa.VARCHAR(length=100),
               type_=sa.String(length=45),
               nullable=False)
        batch_op.drop_column('password')

    with op.batch_alter_table('warehouses', schema=None) as batch_op:
        batch_op.alter_column('organization_id',
               existing_type=sa.UUID(),
               nullable=False)
        batch_op.alter_column('name',
               existing_type=sa.VARCHAR(length=255),
               type_=sa.String(length=100),
               existing_nullable=False)

    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('warehouses', schema=None) as batch_op:
        batch_op.alter_column('name',
               existing_type=sa.String(length=100),
               type_=sa.VARCHAR(length=255),
               existing_nullable=False)
        batch_op.alter_column('organization_id',
               existing_type=sa.UUID(),
               nullable=True)

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('password', sa.VARCHAR(length=255), autoincrement=False, nullable=False))
        batch_op.alter_column('ip_address',
               existing_type=sa.String(length=45),
               type_=sa.VARCHAR(length=100),
               nullable=True)
        batch_op.alter_column('role_id',
               existing_type=sa.UUID(),
               nullable=True)
        batch_op.alter_column('username',
               existing_type=sa.String(length=100),
               type_=sa.VARCHAR(length=255),
               existing_nullable=False)
        batch_op.drop_column('password_hash')

    with op.batch_alter_table('organizations', schema=None) as batch_op:
        batch_op.add_column(sa.Column('web_service_address', sa.VARCHAR(length=255), autoincrement=False, nullable=False))
        batch_op.drop_constraint(None, type_='unique')
        batch_op.alter_column('identification_code',
               existing_type=sa.String(length=50),
               type_=sa.VARCHAR(length=100),
               existing_nullable=False)
        batch_op.alter_column('name',
               existing_type=sa.String(length=100),
               type_=sa.VARCHAR(length=255),
               existing_nullable=False)
        batch_op.drop_column('web_service_url')

    # ### end Alembic commands ###
