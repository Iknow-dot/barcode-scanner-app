"""user warehouses

Revision ID: 24562c11eb8a
Revises: 03e8f6665ddb
Create Date: 2024-10-15 13:23:45.713256

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.engine.reflection import Inspector

# revision identifiers, used by Alembic.
revision = '24562c11eb8a'
down_revision = '03e8f6665ddb'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    constraints = inspector.get_unique_constraints('user_warehouses')
    constraint_names = [constraint['name'] for constraint in constraints]

    with op.batch_alter_table('user_warehouses', schema=None) as batch_op:
        batch_op.alter_column('id',
                              existing_type=sa.INTEGER(),
                              type_=UUID(as_uuid=True),
                              existing_nullable=False,
                              postgresql_using='id::text::uuid')
        batch_op.alter_column('user_id',
                              existing_type=sa.INTEGER(),
                              type_=UUID(as_uuid=True),
                              nullable=False,
                              postgresql_using='user_id::text::uuid')
        batch_op.alter_column('warehouse_id',
                              existing_type=sa.INTEGER(),
                              type_=UUID(as_uuid=True),
                              nullable=False,
                              postgresql_using='warehouse_id::text::uuid')
        if 'user_warehouses_user_id_warehouse_id_key' not in constraint_names:
            batch_op.create_unique_constraint('user_warehouses_user_id_warehouse_id_key', ['user_id', 'warehouse_id'])
        batch_op.create_foreign_key(None, 'users', ['user_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key(None, 'warehouses', ['warehouse_id'], ['id'], ondelete='CASCADE')

def downgrade():
    with op.batch_alter_table('user_warehouses', schema=None) as batch_op:
        batch_op.drop_constraint(None, type_='foreignkey')
        batch_op.drop_constraint(None, type_='foreignkey')
        batch_op.drop_constraint('user_warehouses_user_id_warehouse_id_key', type_='unique')
        batch_op.alter_column('warehouse_id',
                              existing_type=UUID(as_uuid=True),
                              type_=sa.INTEGER(),
                              nullable=False,
                              postgresql_using='warehouse_id::uuid::text::integer')
        batch_op.alter_column('user_id',
                              existing_type=UUID(as_uuid=True),
                              type_=sa.INTEGER(),
                              nullable=False,
                              postgresql_using='user_id::uuid::text::integer')
        batch_op.alter_column('id',
                              existing_type=UUID(as_uuid=True),
                              type_=sa.INTEGER(),
                              nullable=False,
                              autoincrement=True,
                              postgresql_using='id::uuid::text::integer')
        batch_op.create_foreign_key('user_warehouses_user_id_fkey', 'users', ['user_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key('user_warehouses_warehouse_id_fkey', 'warehouses', ['warehouse_id'], ['id'], ondelete='CASCADE')
        batch_op.create_unique_constraint('user_warehouses_user_id_warehouse_id_key', ['user_id', 'warehouse_id'])
        
    # ### end Alembic commands ###
