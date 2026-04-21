// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import AccountsTagsView from '../AccountsTagsView.svelte'
import { messages } from '../app-view'

const copy = messages['zh-CN']

describe('AccountsTagsView', () => {
  it('renders linked accounts and allows creating a tag when input is non-empty', async () => {
    const submitNewTag = vi.fn().mockResolvedValue(undefined)

    render(AccountsTagsView, {
      props: {
        compactGhostButton: 'ghost',
        iconRowButton: 'icon',
        copy,
        tags: [
          {
            id: 'tag-1',
            name: '重点',
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z'
          }
        ],
        accounts: [
          {
            id: 'acct-1',
            email: 'user@example.com',
            tagIds: ['tag-1'],
            createdAt: '2026-04-21T00:00:00.000Z',
            updatedAt: '2026-04-21T00:00:00.000Z'
          }
        ],
        loginActionBusy: false,
        tagMutationBusy: false,
        newTagName: '',
        editingTagId: null,
        editingTagName: '',
        submitNewTag,
        beginEditingTag: vi.fn(),
        cancelEditingTag: vi.fn(),
        saveEditedTag: vi.fn().mockResolvedValue(undefined),
        confirmDeleteTag: vi.fn().mockResolvedValue(undefined),
        taggedAccountCount: (tagId: string) => (tagId === 'tag-1' ? 1 : 0)
      }
    })

    expect(screen.getByText('user@example.com')).toBeTruthy()

    const createButton = screen.getByRole('button', { name: copy.createTag })
    expect((createButton as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.input(screen.getByPlaceholderText(copy.newTagPlaceholder), {
      target: { value: ' 新标签 ' }
    })

    expect((createButton as HTMLButtonElement).disabled).toBe(false)

    await fireEvent.click(createButton)

    expect(submitNewTag).toHaveBeenCalledOnce()
  })

  it('renders editing mode and forwards save/delete actions', async () => {
    const saveEditedTag = vi.fn().mockResolvedValue(undefined)
    const confirmDeleteTag = vi.fn().mockResolvedValue(undefined)
    const tag = {
      id: 'tag-1',
      name: '重点',
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:00.000Z'
    }

    const { rerender } = render(AccountsTagsView, {
      props: {
        compactGhostButton: 'ghost',
        iconRowButton: 'icon',
        copy,
        tags: [tag],
        accounts: [],
        loginActionBusy: false,
        tagMutationBusy: false,
        newTagName: '',
        editingTagId: 'tag-1',
        editingTagName: '重点',
        submitNewTag: vi.fn().mockResolvedValue(undefined),
        beginEditingTag: vi.fn(),
        cancelEditingTag: vi.fn(),
        saveEditedTag,
        confirmDeleteTag,
        taggedAccountCount: () => 0
      }
    })

    await fireEvent.input(screen.getByDisplayValue('重点'), {
      target: { value: '重点账号' }
    })
    await fireEvent.click(screen.getByRole('button', { name: copy.save }))

    expect(saveEditedTag).toHaveBeenCalledWith(tag)

    await rerender({
      compactGhostButton: 'ghost',
      iconRowButton: 'icon',
      copy,
      tags: [tag],
      accounts: [],
      loginActionBusy: false,
      tagMutationBusy: false,
      newTagName: '',
      editingTagId: null,
      editingTagName: '',
      submitNewTag: vi.fn().mockResolvedValue(undefined),
      beginEditingTag: vi.fn(),
      cancelEditingTag: vi.fn(),
      saveEditedTag,
      confirmDeleteTag,
      taggedAccountCount: () => 0
    })

    await fireEvent.click(screen.getByRole('button', { name: `${copy.deleteTag} · ${tag.name}` }))

    expect(confirmDeleteTag).toHaveBeenCalledWith(tag)
  })
})
