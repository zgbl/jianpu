import unittest
from lyric_credits import filter_credit_blocks

class CreditFilterTests(unittest.TestCase):
    def test_repeated_credits_preserve_neighbor_lyrics(self):
        text='我会等你作曲 李宗盛编曲 李宗盛作曲 李宗盛作曲 李宗盛走到天涯'
        letters='我会等你作编作作曲宗盛走到天涯'
        words=[dict(text=c,start=i,end=i+1,probability=.99) for i,c in enumerate(letters)]
        cleaned,kept,blocks=filter_credit_blocks(text,words)
        self.assertEqual(cleaned,'我会等你走到天涯')
        self.assertEqual(''.join(w['text'] for w in kept),'我会等你走到天涯')
        self.assertEqual(len(blocks),1)
    def test_normal_lyrics_are_not_blacklisted(self):
        text='我为你作曲我为你作曲你来唱歌'
        words=[dict(text=c,start=i,end=i+1) for i,c in enumerate(text)]
        self.assertEqual(filter_credit_blocks(text,words),(text,words,[]))
    def test_isolated_ambiguous_credit_is_retained(self):
        text='有人说作曲 李宗盛是一种记忆'
        self.assertEqual(filter_credit_blocks(text,[]),(text,[],[]))

if __name__=='__main__': unittest.main()


class FragmentedCreditFilterTests(unittest.TestCase):
    def test_full_decoder_text_removes_fragmented_timestamp_letters(self):
        text='作词 李宗盛演唱 李宗盛演唱 李宗盛才能出现亲爱的你'
        letters='词宗盛盛演宗才能出现亲爱的你'
        words=[dict(text=c,start=i,end=i+1,probability=.99) for i,c in enumerate(letters)]
        cleaned,kept,blocks=filter_credit_blocks(text,words)
        self.assertEqual(cleaned,'才能出现亲爱的你')
        self.assertEqual(''.join(w['text'] for w in kept),'才能出现亲爱的你')
        self.assertTrue(blocks)

    def test_compact_multi_role_same_name_is_a_credit_block(self):
        text='作词李宗盛作曲李宗盛 演唱李宗盛 亲爱的你'
        words=[dict(text=c,start=i,end=i+1) for i,c in enumerate(text) if not c.isspace()]
        cleaned,kept,blocks=filter_credit_blocks(text,words)
        self.assertEqual(cleaned,'亲爱的你')
        self.assertEqual(''.join(w['text'] for w in kept),'亲爱的你')

    def test_name_alone_or_normal_sung_words_are_never_blacklisted(self):
        for text in ['宗盛唱出了我的心声','亲爱的你好想再见你一面','我为你作词我为你作曲','词宗盛盛演宗才能出现']:
            words=[dict(text=c,start=i,end=i+1) for i,c in enumerate(text)]
            self.assertEqual(filter_credit_blocks(text,words),(text,words,[]))

    def test_compact_final_name_glued_to_actual_lyrics(self):
        text='作词李宗盛演唱李宗盛才能出现亲爱的你'
        words=[dict(text=c,start=i,end=i+1) for i,c in enumerate('词宗盛演宗才能出现亲爱的你')]
        cleaned,kept,blocks=filter_credit_blocks(text,words)
        self.assertEqual(cleaned,'才能出现亲爱的你')
        self.assertEqual(''.join(w['text'] for w in kept),'才能出现亲爱的你')
